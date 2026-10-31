// Git hooks and `git rebase --exec` export GIT_DIR and friends. Inherited by
// the tests, they would point every temp-repo git call at this repository.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}
