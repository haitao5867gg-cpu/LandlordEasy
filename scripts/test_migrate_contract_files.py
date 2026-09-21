import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('migrate-contract-files.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.src = self.root / 'data/uploads'
        self.dst = self.root / 'data/private/contracts'
        self.src.mkdir(parents=True)
        self.name = 'contract-12-signed.pdf'
        (self.src / self.name).write_bytes(b'%PDF-fixture')

    def test_dry_run_does_not_create_directory_or_change_files(self):
        self.assertEqual(migration.migrate(self.root), 1)
        self.assertFalse(self.dst.exists())
        self.assertEqual((self.src / self.name).read_bytes(), b'%PDF-fixture')

    def test_apply_and_repeat_preserve_noncontract(self):
        (self.src / 'repair.jpg').write_bytes(b'image')
        self.assertEqual(migration.migrate(self.root, True), 1)
        self.assertEqual(migration.migrate(self.root, True), 0)
        self.assertFalse((self.src / self.name).exists())
        self.assertEqual((self.dst / self.name).read_bytes(), b'%PDF-fixture')
        self.assertEqual((self.dst / self.name).stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.src / 'repair.jpg').read_bytes(), b'image')

    def test_identical_destination_verifies_and_removes_source(self):
        self.dst.mkdir(parents=True)
        (self.dst / self.name).write_bytes(b'%PDF-fixture')
        migration.migrate(self.root, True)
        self.assertFalse((self.src / self.name).exists())

    def test_conflict_aborts_entire_preflight(self):
        self.dst.mkdir(parents=True)
        (self.dst / self.name).write_bytes(b'conflict')
        (self.src / 'contract-1-preview.pdf').write_bytes(b'other')
        for apply in [False, True]:
            with self.assertRaises(ValueError):
                migration.migrate(self.root, apply)
        self.assertTrue((self.src / self.name).exists())
        self.assertFalse((self.dst / 'contract-1-preview.pdf').exists())

    def test_file_symlinks_rejected_source_and_destination(self):
        outside = self.root / 'outside.pdf'
        outside.write_bytes(b'secret')
        (self.src / self.name).unlink()
        (self.src / self.name).symlink_to(outside)
        with self.assertRaises(OSError):
            migration.migrate(self.root, True)
        (self.src / self.name).unlink()
        (self.src / self.name).write_bytes(b'%PDF-fixture')
        self.dst.mkdir(parents=True)
        (self.dst / self.name).symlink_to(outside)
        with self.assertRaises(OSError):
            migration.migrate(self.root, True)
        self.assertEqual(outside.read_bytes(), b'secret')
        self.assertTrue((self.src / self.name).exists())

    def test_directory_symlinks_rejected(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (self.root / 'data/private').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            migration.migrate(self.root, True)
        self.assertEqual(list(outside.iterdir()), [])

    def test_source_parent_symlink_rejected(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.root / 'data', target_is_directory=True)
        with self.assertRaises(OSError):
            migration.directory(alias / 'uploads')

    def test_hardlinks_rejected(self):
        import os
        os.link(self.src / self.name, self.root / 'external-link.pdf')
        with self.assertRaises(ValueError):
            migration.migrate(self.root, True)

    def test_case_normalization(self):
        (self.src / self.name).rename(self.src / self.name.upper())
        migration.migrate(self.root, True)
        self.assertTrue((self.dst / self.name).exists())

    def test_unrecognized_contract_entries_abort(self):
        (self.src / 'contract-unknown.pdf').write_bytes(b'%PDF')
        with self.assertRaises(ValueError):
            migration.migrate(self.root, True)
        self.assertFalse(self.dst.exists())


if __name__ == '__main__':
    unittest.main()
