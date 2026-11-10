import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const temporary: string[] = [];
function fixture() {
 const dir = mkdtempSync(path.join(tmpdir(), 'harbor-backup-test-')); temporary.push(dir);
 const bin = path.join(dir, 'bin'); mkdirSync(bin);
 const backup = path.join(dir, 'private'); mkdirSync(backup, { mode: 0o700 });
 const shell = (name: string, body: string) => writeFileSync(path.join(bin, name), '#!/bin/sh\nset -eu\n' + body, { mode: 0o700 });
 shell('stat', 'echo 700\n'); // Linux stat syntax on macOS test hosts.
 shell('flock', 'exit 0\n');
 shell('docker', `case "$*" in
 *pg_database_size*) echo 1024;;
 *du\\ -sk*) echo '1 /app/uploads';;
 *pg_dump*) test "\${FAIL_DUMP:-0}" != 1; printf 'mock-private-dump';;
 *pg_restore*) cat >/dev/null;;
 *tar\\ czf*) tar czf - -C "${dir}" input.txt;;
 *) exit 2;;
 esac\n`);
 writeFileSync(path.join(dir, 'input.txt'), 'private attachment');
 const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_DIR: backup, BACKUP_MIN_FREE_MB: '0', BACKUP_RETENTION_DAYS: '0' };
 return { dir, backup, env, run: (extra = {}) => spawnSync('bash', ['../scripts/backup.sh'], { env: { ...env, ...extra }, encoding: 'utf8' }) };
}
afterEach(() => { temporary.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
it('creates private paired backup artifacts and a checksum manifest', () => {
 const f = fixture(), r = f.run(); expect(r.status, r.stderr).toBe(0);
 const names = readdirSync(f.backup); expect(names.filter(n => n.endsWith('.dump'))).toHaveLength(1); expect(names.filter(n => n.endsWith('.tar.gz'))).toHaveLength(1); expect(names.filter(n => n.endsWith('.sha256'))).toHaveLength(1);
 for (const name of names) expect(statSync(path.join(f.backup, name)).mode & 0o077).toBe(0);
});
it('returns failure when dump generation fails and never labels an incomplete pair complete', () => {
 const f = fixture(), r = f.run({ FAIL_DUMP: '1' }); expect(r.status).not.toBe(0);
 expect(readdirSync(f.backup).filter(n => n.endsWith('.sha256'))).toEqual([]);
});
it('checks disk reserve before writing backup artifacts', () => {
 const f = fixture(), r = f.run({ BACKUP_MIN_FREE_MB: '999999999' }); expect(r.status).not.toBe(0);
 expect(readdirSync(f.backup).filter(n => n.endsWith('.dump'))).toEqual([]);
});
it('restores uploads only into a new isolated directory and refuses traversal archives', () => {
 const f = fixture(), archive = path.join(f.dir, 'safe.tar.gz'), target = path.join(f.dir, 'harbor_restore_uploads');
 const python = spawnSync('python3', ['-c', `import tarfile,io
with tarfile.open(${JSON.stringify(archive)},'w:gz') as t:
 i=tarfile.TarInfo('image.txt');i.size=7;t.addfile(i,io.BytesIO(b'private'))
`], { encoding: 'utf8' }); expect(python.status, python.stderr).toBe(0);
 const restore = () => spawnSync('python3', ['../scripts/restore-uploads.py', archive, target], { encoding: 'utf8' });
 expect(restore().status).toBe(0); expect(readFileSync(path.join(target, 'image.txt'), 'utf8')).toBe('private'); expect(restore().status).not.toBe(0);
 const dangerous = path.join(f.dir, 'bad.tar.gz');
 spawnSync('python3', ['-c', `import tarfile,io
with tarfile.open(${JSON.stringify(dangerous)},'w:gz') as t:
 i=tarfile.TarInfo('../escape');i.size=1;t.addfile(i,io.BytesIO(b'x'))
`]);
 expect(spawnSync('python3', ['../scripts/restore-uploads.py', dangerous, path.join(f.dir, 'harbor_restore_bad')]).status).not.toBe(0);
});
