# Basic Hosted Agent (Responses Protocol)

A minimal [Agent Framework](https://github.com/microsoft/agent-framework) agent hosted on Microsoft Foundry using the **Responses protocol**. This sample demonstrates basic request/response interaction and multi-turn conversations.

## How it works

The agent is served via `ResponsesHostServer`, which exposes a REST API compatible with the OpenAI Responses protocol. `MODEL_PROVIDER` in `.env` picks the model behind it. See [main.py](src/agent-framework-agent-basic-responses/main.py) for the implementation.

| `MODEL_PROVIDER` | Cost | What you need |
| --- | --- | --- |
| `github` (default) | Free, rate-limited | A GitHub account, signed in with `gh auth login` or a `GITHUB_TOKEN` |
| `ollama` | Free, runs on your PC | [Ollama](https://ollama.com/download) and a pulled model (`ollama pull llama3.2`) |
| `foundry` | Paid Azure usage | A Foundry project and model deployment (Options 1 and 2 below) |

## Run it free in VS Code (no Azure)

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then in `src/agent-framework-agent-basic-responses` run `uv sync --frozen --python 3.13`.
2. Copy `.env.example` to `.env`. Keep `MODEL_PROVIDER=github` and either sign in with `gh auth login` or paste a GitHub token into `GITHUB_TOKEN` (fine-grained token with **Models: read**). For a fully offline agent, use `MODEL_PROVIDER=ollama` instead.
3. In VS Code, select the `.venv` interpreter (**Python: Select Interpreter**) and press **F5**. The agent starts on `http://localhost:8088` and the free Foundry Toolkit **Agent Inspector** opens so you can chat with it. No Azure sign-in is needed.

Set `MODEL_NAME` to try another model, e.g. `openai/gpt-4.1` or any other ID from the [GitHub Models catalog](https://github.com/marketplace?type=models), or any model you have pulled in Ollama. Deploying to Foundry (below) switches the agent to `foundry` automatically.

## Option 1: Azure Developer CLI (`azd`)

<details>
<summary><strong>Show steps</strong></summary>

### Prerequisites

1. **Azure Developer CLI (`azd`)** — [Install azd](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/install-azd)
2. Install the AI agent extension:
   ```bash
   azd ext install microsoft.foundry
   ```
3. Authenticate:
   ```bash
   azd auth login
   ```

### Initialize the agent project

No cloning required. Create a new folder and initialize from the manifest:

```bash
mkdir my-basic-agent && cd my-basic-agent

azd ai agent init -m https://github.com/microsoft-foundry/foundry-samples/blob/main/samples/python/hosted-agents/agent-framework/responses/01-basic/azure.yaml
```

Follow the prompts to configure your Foundry project and model deployment. If you don't have an existing Foundry project, `azd ai agent init` will guide you through creating one.

### Provision Azure resources (if needed)

If you don't already have a Foundry project and model deployment:

```bash
azd provision
```

### Run the agent locally

```bash
azd ai agent run
```

The agent host will start on `http://localhost:8088`.

### Invoke the local agent

In a separate terminal, from the project directory:

```bash
azd ai agent invoke --local "Hi"
```

### Deploy to Foundry

Once tested locally, deploy to Microsoft Foundry:

```bash
azd deploy
```

For the full deployment guide, see [Deploy a hosted agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/deploy-hosted-agent).

### Invoke the deployed agent

```bash
azd ai agent invoke "Hi"
```

</details>

## Option 2: VS Code (Foundry Toolkit)

### Prerequisites

1. **VS Code** with the **[Foundry Toolkit](https://marketplace.visualstudio.com/items?itemName=ms-windows-ai-studio.windows-ai-studio)** extension installed.
2. For debugging Python in VS Code, install the **[Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)** extension pack.

### Set up the Python virtual environment

- With Python 3.13 or later and [pipx](https://pipx.pypa.io/stable/installation/), install uv outside the project environment, then let uv create and synchronize the locked environment:

  ```bash
   pipx install uv==0.11.7
   uv sync --frozen --python 3.13
  ```
- Open the Command Palette (`Ctrl+Shift+P`), run **Python: Select Interpreter**, and select the `.venv` created by uv.

### Run and debug the agent

Press **F5** to start the agent. The agent starts and the **Agent Inspector** opens automatically. Chat with the agent in the Inspector.

### Or run manually, then open the Inspector

1. Set the required environment variables and sign in to Azure with the Azure CLI (`az login`).
2. Start the agent: `uv run --no-sync python main.py` (listens on `http://localhost:8088`).
3. Command Palette (`Ctrl+Shift+P`) → **Foundry Toolkit: Open Agent Inspector**, then send a message to test.

### Deploy to Foundry

1. Open the Command Palette (`Ctrl+Shift+P`) and run **Foundry Toolkit: Deploy Hosted Agent**. The extension opens a **Deploy Hosted Agent** wizard and reads `agent.yaml` to auto-populate settings.
2. If prompted, complete **Foundry Project Setup** to select subscription and project.
3. On the **Basics** tab, choose deployment method (**Code** or **Container**) and confirm the agent name.
4. On **Review + Deploy**, confirm runtime details, pick **CPU and Memory** size, and click **Deploy**.
5. After deployment, invoke the agent in the Agent Playground and stream live logs from the **Logs** tab.

## Next steps

- [Quickstart: Create a hosted agent](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/quickstart-hosted-agent) — end-to-end walkthrough using `azd`
- [Tool catalog](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/tool-catalog) — browse available tools to extend your agent (Bing Search, Azure AI Search, file search, code interpreter, and more)
- [Manage hosted agents](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/manage-hosted-agent) — monitor and manage deployed agents
- [Add tools to your agent](https://github.com/microsoft-foundry/foundry-samples/tree/be4706c76acfe44e2ae99c2818efdc4c5ab25bd9/samples/python/hosted-agents/agent-framework/responses/02-tools/) — sample with local tool functions
- [Use Foundry Toolbox](https://github.com/microsoft-foundry/foundry-samples/tree/be4706c76acfe44e2ae99c2818efdc4c5ab25bd9/samples/python/hosted-agents/agent-framework/responses/04-foundry-toolbox/) — sample with Azure Foundry Toolbox integration
