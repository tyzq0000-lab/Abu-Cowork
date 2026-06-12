# Digital Employee Package Runtime Contract

Fuyao treats a digital employee as a job Agent, not as a collection of Skills.
The package manifest remains `.codebuddy-plugin/plugin.json` and may add a
`runtime` object with `version: 1`.

## Package Responsibilities

- `agents`: identity, job goal, operating method, boundaries, and escalation rules.
- `skills`: executable job capabilities.
- `runtime.memory`: long-term memory scope and automatically captured information.
- `runtime.workflows`: user-confirmed schedule or event-trigger templates.
- `runtime.review`: measurable review metrics.
- `runtime.evolution`: automatic memory and approval boundaries for capability changes.
- `runtime.acceptance`: repeatable end-to-end acceptance cases.
- `runtime.dependencies`: accounts, services, environment, commands, and workspaces.
- `runtime.sources`: capability extraction ledger for upstream open-source projects.

Fuyao owns the Agent loop, tools, memory engine, scheduler, trigger engine,
background execution, permissions, audit trail, and capability proposals.
Templates are not created silently. Fuyao displays them after installation and
creates them only after user confirmation.

## Example

```json
{
  "name": "content-operator",
  "agentName": "content-operator",
  "agents": ["./agents/content-operator.md"],
  "skills": ["./skills/content-review"],
  "runtime": {
    "version": 1,
    "targetMaturity": "L3",
    "memory": {
      "scope": "project",
      "autoCapture": ["preference", "feedback", "failure", "project"]
    },
    "workflows": [
      {
        "id": "weekly-review",
        "kind": "schedule",
        "name": "Weekly content review",
        "prompt": "Review this week's content and propose next week's plan.",
        "skillName": "content-review",
        "recommended": true,
        "schedule": {
          "frequency": "weekly",
          "dayOfWeek": 3,
          "time": { "hour": 9, "minute": 0 }
        }
      }
    ],
    "review": {
      "cadence": "weekly",
      "metrics": [
        {
          "id": "completion-rate",
          "name": "Completion rate",
          "description": "Completed planned deliverables divided by planned deliverables",
          "target": ">= 95%"
        }
      ]
    },
    "evolution": {
      "memoryWrites": "auto",
      "capabilityChanges": "approval",
      "workflowChanges": "approval",
      "triggerChanges": "approval"
    },
    "escalation": {
      "conditions": ["Missing account", "Publishing to a production channel"],
      "fallback": "Stop and request user approval"
    },
    "acceptance": [
      {
        "name": "Complete weekly review",
        "prompt": "Run a weekly review against the fixture dataset",
        "assertions": ["Metrics comparison exists", "Next-week plan exists"]
      }
    ],
    "dependencies": [
      {
        "name": "Content workspace",
        "type": "workspace",
        "required": true,
        "description": "Historical performance data and generated reports"
      }
    ],
    "sources": [
      {
        "name": "upstream-content-analyzer",
        "origin": "https://example.com/upstream-content-analyzer",
        "license": "MIT",
        "integration": "adapted",
        "adoptedCapabilities": ["Content scoring"],
        "excludedCapabilities": ["Standalone web UI"],
        "exclusionReasons": ["Fuyao provides the runtime UI"],
        "recoveryCost": "low"
      }
    ]
  }
}
```

## Maturity Rules

- `L0`: manifest, identity, or declared Skill entry files are incomplete.
- `L1`: identity and Skills load, but no persistent runtime contract exists.
- `L2`: project/user memory and at least one workflow template are declared.
- `L3`: L2 plus a recommended workflow, review metrics, governed evolution,
  escalation, acceptance cases, and a complete source capability ledger.

Required runtime dependencies do not change package maturity. They are reported
separately as runtime configuration or external-service requirements.

## Audit Command

```powershell
npm.cmd run audit:employees -- "D:\path\to\employee-packages"
npm.cmd run audit:employees -- "D:\path\to\employee.zip" --json
```

The report separates employee-package gaps, Fuyao runtime gaps, runtime
configuration gaps, and external-service limits.
