import unittest

from orchestrator import CommunicationsOrchestrator, OrchestrationRequest


class FakeStore:
    def __init__(self):
        self.events = []
        self.claimed = True

    def create_pending(self, request):
        self.events.append(("persist", request.task_id))
        return request.task_id

    def claim(self, task_id, worker_id):
        self.events.append(("claim", task_id, worker_id))
        return self.claimed

    def mark_completed(self, task_id, result):
        self.events.append(("complete", task_id, result))

    def mark_failed(self, task_id, reason):
        self.events.append(("failed", task_id, reason))


class FakeAgent:
    def __init__(self, events):
        self.events = events

    def execute(self, action, channel, payload):
        self.events.append(("execute", action, channel))
        return "draft prepared"


def request(**overrides):
    values = dict(
        task_id="task-1",
        owner_id="owner-1",
        idempotency_key="idem-1",
        channel="whatsapp",
        action="draft",
        payload={"message": "Hello"},
    )
    values.update(overrides)
    return OrchestrationRequest(**values)


class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.store = FakeStore()
        self.agent = FakeAgent(self.store.events)
        self.runner = CommunicationsOrchestrator(self.store, self.agent, "worker-1")

    def test_persists_before_execution_and_completes_only_approved_task(self):
        receipt = self.runner.submit(request(approved=True))
        self.assertEqual(receipt.status, "completed")
        self.assertEqual(self.store.events[0], ("persist", "task-1"))
        self.assertEqual(self.store.events[1], ("claim", "task-1", "worker-1"))
        self.assertEqual(self.store.events[2], ("execute", "draft", "whatsapp"))
        self.assertEqual(self.store.events[3][0], "complete")

    def test_unapproved_task_is_persisted_without_execution(self):
        receipt = self.runner.submit(request())
        self.assertEqual(receipt.status, "pending_approval")
        self.assertEqual(self.store.events, [("persist", "task-1")])

    def test_already_claimed_task_is_not_executed_twice(self):
        self.store.claimed = False
        receipt = self.runner.submit(request(approved=True))
        self.assertEqual(receipt.status, "already_claimed")
        self.assertFalse(any(event[0] == "execute" for event in self.store.events))

    def test_rejects_dispatch_actions(self):
        with self.assertRaisesRegex(ValueError, "Only analyse and draft"):
            self.runner.submit(request(action="send"))
        self.assertEqual(self.store.events, [])

    def test_rejects_missing_owner_and_unknown_channel(self):
        with self.assertRaisesRegex(ValueError, "owner_id"):
            self.runner.submit(request(owner_id=" "))
        with self.assertRaisesRegex(ValueError, "Unsupported communications channel"):
            self.runner.submit(request(channel="telegram"))
        self.assertEqual(self.store.events, [])

    def test_worker_failure_is_recorded_and_propagated(self):
        class BrokenAgent:
            def execute(self, action, channel, payload):
                raise RuntimeError("internal failure")

        runner = CommunicationsOrchestrator(self.store, BrokenAgent(), "worker-1")
        with self.assertRaisesRegex(RuntimeError, "internal failure"):
            runner.submit(request(approved=True))
        self.assertEqual(self.store.events[-1], ("failed", "task-1", "RuntimeError"))


if __name__ == "__main__":
    unittest.main()
