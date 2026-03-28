# @amodalai/cli

The developer CLI for building, testing, and deploying Amodal agents.

## Install

```bash
npm install -g @amodalai/cli
```

## Quick start

```bash
amodal init my-agent
cd my-agent
amodal dev
```

## Commands

| Command          | Description                            |
| ---------------- | -------------------------------------- |
| `amodal init`    | Scaffold a new agent project           |
| `amodal dev`     | Start local dev server with hot reload |
| `amodal chat`    | Interactive chat session               |
| `amodal connect` | Manage external service connections    |
| `amodal eval`    | Run evaluation suites                  |
| `amodal build`   | Build agent snapshot                   |
| `amodal deploy`  | Deploy to platform                     |
| `amodal install` | Install a plugin package               |
| `amodal publish` | Publish plugins to marketplace         |
| `amodal search`  | Search repo contents                   |

See `amodal --help` for the full command list.

## Documentation

[docs.amodalai.com](https://docs.amodalai.com)

## License

[MIT](../../LICENSE)
