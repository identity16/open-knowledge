# Review standards

## Test coverage changes

Read the **Test changes** check summary and its complete `test-definition-changes` artifact when reviewing deleted, renamed, or replaced tests.

For each removed definition, confirm that its behavior was intentionally retired or remains covered by an equivalent test. Check the assertions and dependencies: a platform word in a title or an enclosing skip condition does not establish that the behavior belongs only to that platform.

The inventory compares static definitions. Review parameterized rows and helper changes separately because the report does not expand runtime cases. Report unexplained coverage losses with the affected definition and the behavior that would become unprotected.
