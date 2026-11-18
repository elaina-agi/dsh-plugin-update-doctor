using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// Read-only file-use diagnostics. Never closes foreign handles, alters ACLs, shuts down
// applications, or invokes Restart Manager restart/shutdown methods.
internal static class LockProbe
{
    private const uint ShareRead = 1, ShareWrite = 2, ShareDelete = 4;
    private const uint ReadAttributes = 0x80;
    private const uint OpenExisting = 3, OpenReparse = 0x00200000, BackupSemantics = 0x02000000;
    private const uint DirectoryAttribute = 0x10, ReparseAttribute = 0x400;
    private const int MoreData = 234, MaximumFiles = 64;
    private const int MaximumInput = 256 * 1024;
    private static readonly string[] BaseLimitations = new string[] {
        "Restart Manager lists processes using registered files; it does not prove which process caused a sharing violation.",
        "A successful exclusive metadata open only describes that instant; files may be locked or replaced later.",
        "Access denied is not evidence of a file lock. Some processes and files may not be visible to Restart Manager.",
        "PID and startTime must be considered together because process identifiers may be reused.",
        "Process names and restartable flags are diagnostic metadata, never authority to stop or restart a process."
    };

    private sealed class FileResult {
        public string path { get; set; }
        public string probe { get; set; }
        public int win32Code { get; set; }
    }
    private sealed class ProcessResult {
        public int pid { get; set; }
        public string name { get; set; }
        public string startTime { get; set; }
        public string applicationType { get; set; }
        public bool restartable { get; set; }
    }
    private sealed class Result {
        public string status { get; set; }
        public List<FileResult> files { get; set; }
        public List<ProcessResult> processes { get; set; }
        public List<string> limitations { get; set; }
    }

    private static int Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var result = new Result { status = "failed", files = new List<FileResult>(),
            processes = new List<ProcessResult>(), limitations = new List<string>(BaseLimitations) };
        var pins = new List<SafeFileHandle>();
        uint session = 0;
        bool started = false;
        string phase = "input";
        try {
            if (Environment.OSVersion.Platform != PlatformID.Win32NT) {
                result.status = "unsupported";
                result.limitations.Add("This helper supports Windows only.");
            } else {
                var serializer = new JavaScriptSerializer { MaxJsonLength = MaximumInput, RecursionLimit = 8 };
                var input = ReadInput();
                var body = serializer.DeserializeObject(input) as Dictionary<string, object>;
                object supplied;
                if (body == null || !body.TryGetValue("files", out supplied) || body.Count != 1)
                    throw new ArgumentException("Expected files array.");
                var array = supplied as object[];
                if (array == null || array.Length > MaximumFiles) throw new ArgumentException("Too many files or invalid array.");
                var paths = new List<string>();
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var item in array) {
                    var path = item as string;
                    if (!ValidLocalFilePath(path)) throw new ArgumentException("Invalid local file path.");
                    if (seen.Add(path)) paths.Add(path);
                }
                var registered = new List<string>();
                foreach (var path in paths) {
                    bool registerSafe;
                    var row = CheckFile(path, pins, out registerSafe);
                    result.files.Add(row);
                    if (registerSafe && (row.probe == "available" || row.probe == "sharing-violation")) registered.Add(path);
                }
                result.status = "checked";
                if (registered.Count > 0) {
                    var key = new StringBuilder(33);
                    phase = "start-session";
                    var code = RmStartSession(out session, 0, key);
                    if (code != 0) throw new Win32Exception(code);
                    started = true;
                    phase = "register-resources";
                    code = RmRegisterResources(session, (uint)registered.Count, registered.ToArray(), 0, null, 0, null);
                    if (code != 0) throw new Win32Exception(code);
                    phase = "get-list";
                    uint needed = 0, count = 0, reasons = 0;
                    code = RmGetList(session, out needed, ref count, null, ref reasons);
                    if (code != 0 && code != MoreData) throw new Win32Exception(code);
                    for (int attempt = 0; needed > 0 && attempt < 4; attempt++) {
                        if (needed > 512) throw new InvalidOperationException("Restart Manager process limit reached.");
                        count = needed;
                        var processes = new RmProcessInfo[count];
                        code = RmGetList(session, out needed, ref count, processes, ref reasons);
                        if (code == MoreData) continue;
                        if (code != 0) throw new Win32Exception(code);
                        for (int i = 0; i < count; i++) {
                            var info = processes[i];
                            long start = ((long)info.Process.StartTime.High << 32) | info.Process.StartTime.Low;
                            string timestamp;
                            try { timestamp = DateTime.FromFileTimeUtc(start).ToString("o", CultureInfo.InvariantCulture); }
                            catch (ArgumentOutOfRangeException) { timestamp = null; }
                            result.processes.Add(new ProcessResult { pid = info.Process.Pid,
                                name = CleanName(info.ApplicationName), startTime = timestamp,
                                applicationType = ApplicationType(info.ApplicationType), restartable = info.Restartable });
                        }
                        needed = 0;
                    }
                    if (needed > 0) {
                        result.status = "failed";
                        result.limitations.Add("Restart Manager process list changed repeatedly; the result is incomplete.");
                    }
                }
            }
        } catch (ArgumentException) {
            result.status = "failed";
            result.limitations.Add("Input rejected: at most 64 local absolute ordinary-file paths are accepted; ambiguous, device and reparse paths are excluded.");
        } catch (DllNotFoundException) {
            result.status = "unsupported";
            result.limitations.Add("Windows Restart Manager is unavailable.");
        } catch (EntryPointNotFoundException) {
            result.status = "unsupported";
            result.limitations.Add("The required Windows read-only diagnostic API is unavailable.");
        } catch (Win32Exception error) {
            result.status = "failed";
            result.limitations.Add("Restart Manager " + phase + " failed with Windows code " + error.NativeErrorCode.ToString(CultureInfo.InvariantCulture) + ".");
        } catch (Exception) {
            result.status = "failed";
            result.limitations.Add("The read-only diagnostic did not complete; no process or file was modified.");
        } finally {
            if (started) RmEndSession(session);
            for (int i = pins.Count - 1; i >= 0; i--) pins[i].Dispose();
        }
        Console.WriteLine(new JavaScriptSerializer().Serialize(result));
        return 0; // Operational outcome is always explicit in JSON, not an exception dump.
    }

    private static string ReadInput()
    {
        var buffer = new char[4096];
        var text = new StringBuilder();
        int count;
        while ((count = Console.In.Read(buffer, 0, buffer.Length)) > 0) {
            if (text.Length + count > MaximumInput) throw new ArgumentException("Input limit reached.");
            text.Append(buffer, 0, count);
        }
        return text.ToString();
    }

    private static bool ValidLocalFilePath(string path)
    {
        if (String.IsNullOrEmpty(path) || path.Length > 32700 || path.Length < 4 ||
            !((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) ||
            path[1] != ':' || path[2] != '\\' || path.EndsWith("\\", StringComparison.Ordinal)) return false;
        var parts = path.Substring(3).Split('\\');
        foreach (var part in parts) {
            if (part.Length == 0 || part.Length > 255 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ")) return false;
            foreach (char c in part) if (c < 32 || "/:*?\"<>|".IndexOf(c) >= 0) return false;
            string stem = part.Split('.')[0].ToUpperInvariant();
            if (stem == "NUL" || stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "CONIN$" || stem == "CONOUT$") return false;
            if (stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && "123456789¹²³".IndexOf(stem[3]) >= 0) return false;
        }
        return parts.Length <= 256;
    }

    private static FileResult CheckFile(string path, List<SafeFileHandle> allPins, out bool registerSafe)
    {
        registerSafe = false;
        var localPins = new List<SafeFileHandle>();
        try {
            var parts = path.Substring(3).Split('\\');
            string current = path.Substring(0, 3);
            // Pin every ancestor without DELETE/WRITE sharing, so checked names cannot be
            // renamed into reparse points before file probe / Restart Manager registration.
            var anchor = OpenPinned(current, true);
            localPins.Add(anchor);
            for (int i = 0; i < parts.Length - 1; i++) {
                current = current.EndsWith("\\") ? current + parts[i] : current + "\\" + parts[i];
                localPins.Add(OpenPinned(current, true));
            }
            var target = OpenPinned(path, false);
            localPins.Add(target);
            registerSafe = true;
            // READ_ATTRIBUTES alone is not a read-sharing access on Windows and can
            // succeed despite an existing exclusive reader. Request READ_DATA as well,
            // but never read content; this makes the sharing-mode probe meaningful.
            using (var exclusive = CreateFileW(Extended(path), ReadAttributes | 1u, 0, IntPtr.Zero, OpenExisting, OpenReparse, IntPtr.Zero)) {
                if (exclusive.IsInvalid) {
                    int code = Marshal.GetLastWin32Error();
                    allPins.AddRange(localPins); localPins.Clear();
                    return new FileResult { path = path, probe = Classification(code), win32Code = code };
                }
                FileInformation info;
                if (!GetFileInformationByHandle(exclusive, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if ((info.Attributes & (ReparseAttribute | DirectoryAttribute)) != 0) throw new InvalidOperationException("Not ordinary.");
            }
            allPins.AddRange(localPins); localPins.Clear();
            return new FileResult { path = path, probe = "available", win32Code = 0 };
        } catch (Win32Exception error) {
            return new FileResult { path = path, probe = !registerSafe && (error.NativeErrorCode == 32 || error.NativeErrorCode == 33) ? "unknown" : Classification(error.NativeErrorCode), win32Code = error.NativeErrorCode };
        } catch (Exception) {
            return new FileResult { path = path, probe = "unknown", win32Code = 0 };
        } finally {
            for (int i = localPins.Count - 1; i >= 0; i--) localPins[i].Dispose();
        }
    }

    private static SafeFileHandle OpenPinned(string path, bool directory)
    {
        // Desired access 0 is metadata-only and cannot itself cause the subsequent
        // READ_ATTRIBUTES exclusive sharing check to fail. No DELETE sharing pins the name.
        var handle = CreateFileW(Extended(path), 0, directory ? ShareRead : ShareRead | ShareWrite,
            IntPtr.Zero, OpenExisting, OpenReparse | (directory ? BackupSemantics : 0), IntPtr.Zero);
        if (handle.IsInvalid) { int code = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(code); }
        FileInformation info;
        if (!GetFileInformationByHandle(handle, out info)) { int code = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(code); }
        bool actualDirectory = (info.Attributes & DirectoryAttribute) != 0;
        if ((info.Attributes & ReparseAttribute) != 0 || actualDirectory != directory) {
            handle.Dispose(); throw new InvalidOperationException("Reparse or non-ordinary input.");
        }
        return handle;
    }

    private static string Extended(string path) { return "\\\\?\\" + path; }
    private static string Classification(int code)
    {
        if (code == 32 || code == 33) return "sharing-violation";
        if (code == 5) return "access-denied";
        if (code == 2 || code == 3) return "missing";
        return "unknown";
    }
    private static string CleanName(string name)
    {
        if (String.IsNullOrWhiteSpace(name)) return "Unknown";
        var text = new StringBuilder();
        foreach (char c in name) if (!Char.IsControl(c)) text.Append(c);
        return text.ToString();
    }
    private static string ApplicationType(uint type)
    {
        switch (type) {
            case 1: return "main-window";
            case 2: return "other-window";
            case 3: return "service";
            case 4: return "explorer";
            case 5: return "console";
            case 1000: return "critical";
            default: return "unknown";
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
        public uint Attributes; public FileTime Creation, Access, Write; public uint Volume;
        public uint SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)] private struct RmUniqueProcess { public int Pid; public FileTime StartTime; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct RmProcessInfo {
        public RmUniqueProcess Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string ApplicationName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string ServiceShortName;
        public uint ApplicationType, AppStatus, SessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] private static extern int RmStartSession(out uint session, uint flags, StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] private static extern int RmRegisterResources(uint session, uint files, string[] filenames, uint apps, RmUniqueProcess[] applications, uint services, string[] serviceNames);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] private static extern int RmGetList(uint session, out uint needed, ref uint count, [In, Out] RmProcessInfo[] info, ref uint reasons);
    [DllImport("rstrtmgr.dll")] private static extern int RmEndSession(uint session);
}
