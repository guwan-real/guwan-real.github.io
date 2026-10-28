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
The user's complete handbook is organized into 48 syllabus-linked knowledge pages with 24 specialist explanations. Each page includes a separately maintained foundation lesson with concrete examples and worked reasoning, with extra attention to databases, software engineering, and AI. The original handbook remains intact. There are 340 clearly labelled self-authored or adapted questions, a full handbook reader, the original Markdown download, and the provided 2027 syllabus PDF. Questions include worked solutions and individual option explanations; UML and other teaching diagrams are static SVGs.

The latest source review compares 21 local documents (322 PDF pages, including 57 scanned pages), adds targeted explanations to 38 knowledge pages and 98 adapted exercises, and records source locations and questionable keys at `materials/`. Source filenames and hashes identify the reviewed versions; they are not claims of verified official exam papers. The supplied past-paper PDFs and Word files remain local.

Optional cross-device sync uses a separate private GitHub repository and a repository-scoped fine-grained token. No backend service is required. Open **学习状态 → GitHub 私有备份** to connect each device once. Setup, storage and merge behavior are documented in [docs/cs-review-github-sync.md](docs/cs-review-github-sync.md).

```sh
npm test
npm run build
npm run test:static
```

See [content, architecture and data guide](docs/cs-review.md) for adding Markdown knowledge and JSON questions, and [acceptance results](docs/cs-review-validation.md) for verification.
