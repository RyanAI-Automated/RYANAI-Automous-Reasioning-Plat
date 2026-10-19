# 🛡️ Security Policy

The RyanAI engineering team takes the security of our autonomous reasoning platform seriously. We appreciate your efforts to responsibly disclose vulnerabilities.

---

## 📦 Supported Versions

Security updates and patches are actively provided for the following platform versions:

| Version | Supported | Status |
| :--- | :---: | :--- |
| `1.1.x` | :white_check_mark: | **Current Active Release** |
| `1.0.x` | :x: | End of Life (Upgrade Recommended) |
| `< 1.0` | :x: | Unsupported |

---

## 🚨 Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues or public forums.**

### How to Submit a Report
If you believe you have discovered a security vulnerability in RyanAI, please report it through one of the following channels:

1. **GitHub Private Security Advisory (Preferred):** Navigate to the repository's **Security** tab → **Advisories** → **New draft advisory**.
2. **Email Disclosure:** Send an email to `security@ryanai.com` (or your platform security contact) with the subject `[SECURITY] Potential Vulnerability - RyanAI`.

### What to Include
To help us triage and address the issue quickly, please include:
* A detailed description of the vulnerability and potential impact.
* Step-by-step instructions or a Minimal Reproducible Example (PoC) to replicate the issue.
* Any relevant logs, stack traces, or HTTP request/response dumps.
* Affected service (`api`, `web`, `database`, or `cache`).

---

## ⏱️ Response & Escalation SLA

When you submit a security report, you can expect:

* **Initial Acknowledgment:** Within **24 hours** of submission.
* **Status Updates:** Every **72 hours** while the issue is being actively investigated and remediated.
* **Triage & Decision:** If accepted, we will coordinate a fix release window. If declined or determined as intentional behavior, we will provide a clear explanation.
* **Public Disclosure:** Coordinated release once a patch/fix is deployed to active supported branches.

---

## 🔐 Security Best Practices for Self-Hosting

When deploying RyanAI in a production environment, ensure the following hardening steps are applied:

* **Environment Secrets:** Never commit `.env` files or API keys into git. Use environment secret managers in production.
* **HTTPS/TLS:** Ensure TLS 1.3+ is enforced via your reverse proxy/ingress controller.
* **Non-Root Runtime:** Production Docker containers run under the unprivileged `node` user with `dumb-init` signal handling.
* **Dependency Auditing:** Run `npm audit` and container vulnerability checks (`docker scout cves <image>`) regularly as outlined in `RUNBOOK.md`.
