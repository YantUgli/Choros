"""Bus event in-memory per tugas → sumber untuk SSE live console."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

END = object()  # sentinel: stream tugas selesai


class TaskBus:
    def __init__(self, max_queue: int = 2000) -> None:
        self._subs: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self._max_queue = max_queue

    def subscribe(self, task_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._max_queue)
        self._subs[task_id].add(queue)
        return queue

    def unsubscribe(self, task_id: int, queue: asyncio.Queue) -> None:
        subs = self._subs.get(task_id)
        if not subs:
            return
        subs.discard(queue)
        if not subs:
            self._subs.pop(task_id, None)

    def publish(self, task_id: int, payload: dict[str, Any]) -> None:
        for queue in list(self._subs.get(task_id, ())):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # console yang lambat tidak boleh menahan agent
                pass

    def close(self, task_id: int) -> None:
        for queue in list(self._subs.get(task_id, ())):
            try:
                queue.put_nowait(END)
            except asyncio.QueueFull:
                pass

    def subscriber_count(self, task_id: int) -> int:
        return len(self._subs.get(task_id, ()))


bus = TaskBus()
