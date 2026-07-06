# Instructions to Claude

## Testing

Before finalizing major changes to code, do thorough 100% code coverage unit tests, integration tests. For changes that affect both front- and back-end, add e2e tests using Playwright with live front- and back-ends with live test db to ensure correct functionality. All passing passing tests should be reproducible during regression testing as we develop new code.

## Code conventions

Use Prettier and ESLint for code formatting, using default rules except semicolons, which should be avoided. Use ES Module import/export styles.

## Code comments

Leave standard docstring comments for all modules, functions, and for large block of complicated code. Avoid jargon and keep comments concise.

## Specification

An initial specification is written into docs/SPEC.md. This is the general plan for the project, although we may decide to change it along the way.
