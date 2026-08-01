import asyncio
import os
import sys
from collections.abc import AsyncIterator

import pytest

from app.adapters.base import BaseCliAdapter
from app.adapters.registry import build_adapter
from app.events import Event
from app.models import Agent


class DummyAdapter(BaseCliAdapter):
    binary = sys.executable
    
    def build_command(self, prompt: str, *, model, permission_mode, project_path, resume_session_id) -> list[str]:
        return [sys.executable, "-c", "import os; print(os.environ.get('HOME'))"]
        
    def parse_line(self, line: str) -> list[Event]:
        return [Event("output", {"text": line})]
        
    def env_overrides(self) -> dict[str, str]:
        return {"DUMMY_OVERRIDE": "1"}


def test_build_env_with_home_sets_home_and_userprofile():
    """D1: build_env() dengan home diisi -> HOME dan USERPROFILE = path itu"""
    adapter = DummyAdapter(name="dummy", home="/fake/home")
    env = adapter.build_env()
    assert env["HOME"] == "/fake/home"
    assert env["USERPROFILE"] == "/fake/home"
    assert env["DUMMY_OVERRIDE"] == "1"


def test_build_env_without_home_inherits_os_environ():
    """D2: build_env() tanpa home -> HOME sama persis dengan os.environ"""
    adapter = DummyAdapter(name="dummy", home=None)
    env = adapter.build_env()
    
    if "HOME" in os.environ:
        assert env["HOME"] == os.environ["HOME"]
    else:
        assert "HOME" not in env

    if "USERPROFILE" in os.environ:
        assert env["USERPROFILE"] == os.environ["USERPROFILE"]
    else:
        assert "USERPROFILE" not in env
        
    assert env["DUMMY_OVERRIDE"] == "1"


def test_build_adapter_assigns_home():
    """D3: build_adapter(agent, home=X) menghasilkan adapter ber-home X"""
    agent = Agent(name="test_agent", adapter_type="claude_code", user_id=1)
    
    adapter1 = build_adapter(agent, home="/path/to/home1")
    assert adapter1.home == "/path/to/home1"
    
    adapter2 = build_adapter(agent, home=None)
    assert adapter2.home is None


@pytest.mark.asyncio
async def test_two_users_different_homes_in_subprocess():
    """D4: Dua user ber-credential_home beda -> dua nilai HOME beda pada subprocess sungguhan"""
    adapter1 = DummyAdapter(name="dummy1", home="/home/user1")
    adapter2 = DummyAdapter(name="dummy2", home="/home/user2")
    
    # Run the dummy adapter which prints os.environ.get("HOME")
    events1 = [ev async for ev in adapter1.run("prompt")]
    output1 = "".join(ev.data["text"] for ev in events1 if ev.type == "output")
    assert output1 == "/home/user1"
    
    events2 = [ev async for ev in adapter2.run("prompt")]
    output2 = "".join(ev.data["text"] for ev in events2 if ev.type == "output")
    assert output2 == "/home/user2"
