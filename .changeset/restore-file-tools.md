---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/amodal": patch
---

Restore admin agent file tools with draft workspace integration

Add 8 built-in file tools (read_repo_file, write_repo_file, edit_repo_file, delete_repo_file,
list_repo_files, glob_repo_files, grep_repo_files, read_many_repo_files) enabled via
`fileTools: true` in amodal.json. When Studio is running, writes go to the draft API instead
of disk. Pass REPO_PATH to admin agent subprocess so it can access the parent repo.
