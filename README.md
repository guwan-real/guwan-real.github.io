# Personal Homepage

Astro-powered personal homepage for `https://guwan-real.github.io/`.

## Local Development

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## CS Review Appendix

Computer science revision and browser-local practice are available at `/appendix/cs-review/`.
The user's complete handbook is organized into 48 syllabus-linked knowledge pages with 24 specialist explanations. It includes 130 clearly labelled self-authored practice questions, a full handbook reader, the original Markdown download, and the provided 2027 syllabus PDF. The latest 72 questions include worked solutions and individual option explanations.

Optional cross-device sync uses a separate private GitHub repository and a repository-scoped fine-grained token. No backend service is required. Open **学习状态 → GitHub 私有备份** to connect each device once. Setup, storage and merge behavior are documented in [docs/cs-review-github-sync.md](docs/cs-review-github-sync.md).

```sh
npm test
npm run build
npm run test:static
```

See [content, architecture and data guide](docs/cs-review.md) for adding Markdown knowledge and JSON questions, and [acceptance results](docs/cs-review-validation.md) for verification.
