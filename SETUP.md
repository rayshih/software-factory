# Setup

How the factory is allowed to touch a repository, and how it is kept from merging. No working pipeline yet. This records the GitHub App and the safety rules around it. No secrets live in this file.

## Overview

The factory acts on repositories only through a GitHub App:

| | |
|---|---|
| App | Forgeline |
| Bot account | `forgeline-exp-bot[bot]` |
| Owner | [@rayshih](https://github.com/rayshih) |
| Who can install it | Only on this account |
| Installed on | [rayshih/sf-demo-todo-api](https://github.com/rayshih/sf-demo-todo-api) only |

Principle: never run on a repository that has not been explicitly authorised. Installing the App on a repo is that authorisation.

## GitHub App permissions

Repository permissions:

| Permission | Access | Why |
|---|---|---|
| Contents | Read and write | Push the agent's branches |
| Issues | Read and write | Read the task and comment status |
| Pull requests | Read and write | Open and update pull requests |
| Checks | Read | Read CI check results |
| Actions | Read | Read GitHub Actions CI results |
| Metadata | Read | Mandatory on every GitHub App |

Organization and account permissions: none.

No callback URL and no OAuth. The App does not use user authorization tokens. It acts as the installation, through the bot account above.

## Webhook

The webhook is inactive. It will be turned on once the control plane is deployed, and it will use a webhook secret (stored as a deploy secret, not in this repo).

TODO, when that happens:

- [ ] Enable the webhook
- [ ] Set the webhook secret in the deploy environment
- [ ] Subscribe to Issues
- [ ] Subscribe to Issue comment
- [ ] Subscribe to Pull request
- [ ] Subscribe to Pull request review
- [ ] Subscribe to Check suite

## Why the bot can't merge

Contents and pull request write access would technically allow a merge through the API. The installed repo's `main` is protected so that call cannot succeed for Forgeline.

[rayshih/sf-demo-todo-api](https://github.com/rayshih/sf-demo-todo-api) has a ruleset named `protect-main`:

- A pull request is required
- 1 approving review is required
- Stale approvals are dismissed when new commits are pushed
- Required status check: `test`
- Force pushes are blocked
- Deletion is blocked
- Bypass is limited to repository admins (the human)
- Forgeline is not in the bypass list

A GitHub App cannot approve its own pull request, so a human approval is always required. The control plane also has no merge code. Auto-merge is a non-goal.

## Credentials

The App mints a short-lived installation token (1 hour) from its private key. That private key, and the other keys (Trigger.dev, Anthropic), are stored only as secrets in the deploy environment. They are never committed. They are provisioned when the control plane is deployed.

The private key can be rotated or revoked in the GitHub App settings. This document does not record the App ID or any key material.

## Onboarding a pilot repo

Do this for each new repository, and only for that repository:

- [ ] Install Forgeline on that repo only
- [ ] Add the same `protect-main` ruleset
- [ ] Make sure CI has a required status check
- [ ] Start with low-risk issues
