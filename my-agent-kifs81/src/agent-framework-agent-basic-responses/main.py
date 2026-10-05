# Copyright (c) Microsoft. All rights reserved.

import os
import shutil
import subprocess

from agent_framework import Agent
from agent_framework.openai import OpenAIChatCompletionClient
from agent_framework_foundry_hosting import ResponsesHostServer
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Free, OpenAI-compatible model endpoints: (base URL, default model).
# - github: GitHub Models, free with any GitHub account (rate-limited).
# - ollama: models running on this machine through Ollama, no account needed.
FREE_PROVIDERS = {
    "github": ("https://models.github.ai/inference", "openai/gpt-4.1-mini"),
    "ollama": ("http://localhost:11434/v1", "llama3.2"),
}


def github_token():
    """Return GITHUB_TOKEN, falling back to the token of a signed-in GitHub CLI."""
    token = os.getenv("GITHUB_TOKEN")
    if not token and shutil.which("gh"):
        result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=15)
        token = result.stdout.strip()
    if not token:
        raise RuntimeError(
            "No GitHub token found. Set GITHUB_TOKEN in .env, or sign in with `gh auth login`."
        )
    return token


def create_foundry_client():
    # Imported here so the free providers do not need Azure packages at startup.
    from agent_framework.foundry import FoundryChatClient
    from azure.identity import DefaultAzureCredential

    model_name = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME") or os.getenv("FOUNDRY_MODEL_NAME")
    if not model_name:
        raise RuntimeError(
            "Model deployment name is not configured. Set "
            "AZURE_AI_MODEL_DEPLOYMENT_NAME or FOUNDRY_MODEL_NAME."
        )

    return FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=model_name,
        credential=DefaultAzureCredential(),
    )


def create_client(provider):
    if provider == "foundry":
        return create_foundry_client()
    if provider not in FREE_PROVIDERS:
        raise RuntimeError(
            f"Unknown MODEL_PROVIDER '{provider}'. Use github, ollama or foundry."
        )

    base_url, default_model = FREE_PROVIDERS[provider]
    return OpenAIChatCompletionClient(
        base_url=os.getenv("MODEL_BASE_URL") or base_url,
        model=os.getenv("MODEL_NAME") or default_model,
        # Ollama ignores the key but the OpenAI client requires one.
        api_key=github_token() if provider == "github" else "ollama",
    )


def main():
    # Free GitHub Models by default; Foundry when deployed to (or configured for) Azure.
    default_provider = "foundry" if os.getenv("FOUNDRY_PROJECT_ENDPOINT") else "github"
    provider = (os.getenv("MODEL_PROVIDER") or default_provider).strip().lower()

    agent = Agent(
        client=create_client(provider),
        instructions="You are a friendly assistant. Keep your answers brief.",
        # History will be managed by the hosting infrastructure, thus there
        # is no need to store history by the service. Learn more at:
        # https://developers.openai.com/api/reference/resources/responses/methods/create
        default_options={"store": False} if provider == "foundry" else {},
    )

    server = ResponsesHostServer(agent)
    server.run()


if __name__ == "__main__":
    main()
