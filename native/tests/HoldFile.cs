using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
internal static class HoldFile {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    private static int Main(string[] args) {
        if(args.Length!=1 || !Path.IsPathRooted(args[0])) return 2;
        // Test-only: test runner creates this ordinary file before launching us.
        using(var h=CreateFileW(args[0], 0x80000000, 0, IntPtr.Zero, 3, 0x80, IntPtr.Zero)) {
            if(h.IsInvalid)return 3;
            Console.WriteLine("ready");
            Console.Out.Flush();
            Console.ReadLine(); // A graceful stdin message releases only this test process's own handle.
        }
        return 0;
    }
}
