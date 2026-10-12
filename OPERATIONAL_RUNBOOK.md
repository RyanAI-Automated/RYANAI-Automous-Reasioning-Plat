# 📖 RyanAI Operational Runbook

**Version**: 1.1.0  
**Last Updated**: 2026-10-12  
**Status**: Operational guidance; production readiness verified.

---

## 🚀 Daily Operations

### Morning Startup Check (5 min)

```bash
# 1. Verify all services
docker compose ps

# Expected output:
# NAME           STATUS    PORTS
# ryanai-api     Up        0.0.0.0:3000->3000/tcp
# ryanai-web     Up        0.0.0.0:9090->80/tcp
# ryanai-db      Up        5432/tcp
# ryanai-redis   Up        6379/tcp

# 2. Check system health
npm run docker:health

# 3. View recent logs
docker compose logs --tail=50

# 4. Verify endpoints
curl -s http://localhost:3000/health | jq
curl -s http://localhost:9090 | head -20

# 5. Check resource usage
docker stats --no-stream
