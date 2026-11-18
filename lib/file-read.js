import { open, lstat } from 'node:fs/promises';

/** Read an ordinary pinned file with a complete byte cap; reject replacement during the read. */
export async function boundedFile(path, maximum) {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw Error('bounded-file-untrusted');
    const handle = await open(path, 'r');
    try {
        const pinned = await handle.stat();
        if (!pinned.isFile() || pinned.dev !== before.dev || pinned.ino !== before.ino || pinned.size > maximum) throw Error('bounded-file-changed');
        const chunks = []; let total = 0;
        while (true) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - total));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            total += bytesRead; if (total > maximum) throw Error('bounded-file-too-large');
            chunks.push(buffer.subarray(0, bytesRead));
        }
        const after = await handle.stat(), named = await lstat(path);
        if (after.size !== pinned.size || after.mtimeMs !== pinned.mtimeMs || after.ctimeMs !== pinned.ctimeMs || named.isSymbolicLink() || named.dev !== pinned.dev || named.ino !== pinned.ino || total !== after.size) throw Error('bounded-file-changed');
        return Buffer.concat(chunks, total);
    } finally { await handle.close(); }
}
