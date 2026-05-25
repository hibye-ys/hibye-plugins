---
source_url: https://openai.github.io/openai-agents-python/
fetched_at: 2026-05-24
title: OpenAI Agents SDK (Python)
fetcher: claude-code WebFetch
notes: WebFetch returned a summarized extract.
---

# OpenAI Agents SDK Overview

## Core Concepts

The OpenAI Agents SDK provides a lightweight framework for building agentic AI applications. The toolkit centers on three fundamental primitives:

- **Agents**: Language models equipped with instructions and tools
- **Handoffs**: Mechanisms enabling agents to delegate tasks to other agents
- **Guardrails**: Validation systems for agent inputs and outputs

## Design Philosophy

The SDK follows two core principles:
1. Includes sufficient functionality to be practically useful while maintaining a minimal set of primitives for quick adoption
2. Works effectively without configuration but allows extensive customization

## Key Features

- Integrated agent loop handling tool invocation and task completion
- Python-native orchestration capabilities
- Sandbox environments for isolated execution
- Persistent memory layers
- Human-involvement mechanisms
- Built-in tracing for debugging
- Voice agent support via `gpt-realtime-2`

## Installation & Quick Start

```bash
pip install openai-agents
```

A minimal example creates an agent with instructions, then executes it:

```python
from agents import Agent, Runner

agent = Agent(name="Assistant", instructions="You are a helpful assistant")
result = Runner.run_sync(agent, "Write a haiku about recursion in programming.")
print(result.final_output)
```

Set your OpenAI API key via environment variable before running.

## When to Use This SDK

Choose the Agents SDK when you need the runtime managing turns, tool execution, guardrails, handoffs, or session state. It suits multi-step workflows and applications requiring isolated workspaces.

---

> **NOTE**: WebFetch returned a summary rather than the full page. For complete details on:
> - Sessions and memory
> - Tracing
> - Realtime / voice agents
> - MCP integration
> - Workflow orchestration with Temporal
>
> visit https://openai.github.io/openai-agents-python/ directly.
