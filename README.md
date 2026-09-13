# Skills

Public, reusable agent skills maintained by Fred Lackey. Each skill is a
self-contained package stored under a level that communicates its origin or
current maturity.

## Why This Exists

Every time I set up a new computer, there's a handful of things I need
configured and a handful of skills I want available before I can really get
to work. This repository is that set, published in the open. Some of these
skills exist purely to bootstrap a new machine into my own workflow;
others are just generically useful to any developer working with an
agent, regardless of whose setup they use. Nothing in here depends on
private company information — that's a deliberate design constraint, not an
afterthought, and it's what makes publishing this safe.

## Repository Structure

- [`docs/`](docs/) contains repository-wide documentation and helpful information.
- [`skills/draft/`](skills/draft/) contains skills still in development.
- [`skills/canary/`](skills/canary/) contains skills ready for testing.
- [`skills/stable/`](skills/stable/) contains skills ready for production use.
- [`skills/imported/`](skills/imported/) contains skills from external sources.
- [`skills/legacy/`](skills/legacy/) contains retired or older skills, including ones recovered from elsewhere.

Each level has a `README.md` describing the skills currently within it. Every
skill directory contains a required `SKILL.md` and all resources the skill
needs to function independently of this repository.

## Contributing

Criticism, questions, and collaboration are all welcome. If something here
is wrong, unclear, or could be done better, say so. If you have a skill in
the same spirit that you think belongs here, or a fix for one of these, open
a pull request — I'll take a look.

## License

[MIT](LICENSE)

## Contact

**Fred Lackey**
Website: [fredlackey.com](https://fredlackey.com)
Email: [fred.lackey@gmail.com](mailto:fred.lackey@gmail.com)
