"""FastAPI entry point for the Insider Pipecat sidecar.

Next.js controls this service over HTTP (see src/lib/adapters/pipecat.ts):
  POST   /bots                 spawn a bot into a meeting
  POST   /bots/{id}/speak      synthesise text and inject at next VAD pause
  DELETE /bots/{id}            leave the meeting and clean up

All endpoints require: Authorization: Bearer $PIPECAT_SERVICE_SECRET
"""

import asyncio
import hmac
import os
import uuid

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from loguru import logger
from pydantic import BaseModel

from bot import PipecatBot

load_dotenv()

app = FastAPI(title="Insider Pipecat Sidecar")

# bot registry: pipecat_bot_id -> instance / asyncio task
_bots: dict[str, PipecatBot] = {}
_tasks: dict[str, asyncio.Task] = {}


def verify_auth(authorization: str | None = Header(default=None)) -> None:
    secret = os.environ.get("PIPECAT_SERVICE_SECRET", "")
    expected = f"Bearer {secret}"
    if (
        not secret
        or not authorization
        or not hmac.compare_digest(authorization, expected)
    ):
        raise HTTPException(status_code=401, detail="unauthorized")


def get_bot(pipecat_bot_id: str) -> PipecatBot:
    bot = _bots.get(pipecat_bot_id)
    if bot is None:
        raise HTTPException(status_code=404, detail="bot not found")
    return bot


class SpawnBotRequest(BaseModel):
    meeting_url: str
    bot_name: str
    meeting_id: str


class SpeakRequest(BaseModel):
    text: str


@app.post("/bots", dependencies=[Depends(verify_auth)])
async def spawn_bot(req: SpawnBotRequest):
    pipecat_bot_id = uuid.uuid4().hex
    bot = PipecatBot(
        meeting_url=req.meeting_url,
        bot_name=req.bot_name,
        meeting_id=req.meeting_id,
    )
    _bots[pipecat_bot_id] = bot

    task = asyncio.create_task(bot.run())
    _tasks[pipecat_bot_id] = task

    def _on_done(t: asyncio.Task, bot_id: str = pipecat_bot_id):
        _bots.pop(bot_id, None)
        _tasks.pop(bot_id, None)
        if t.cancelled():
            return
        exc = t.exception()
        if exc:
            logger.error("bot crashed bot_id={} error={}", bot_id, exc)

    task.add_done_callback(_on_done)

    logger.info(
        "spawned bot bot_id={} meeting_id={}", pipecat_bot_id, req.meeting_id
    )
    return {"pipecat_bot_id": pipecat_bot_id}


@app.post("/bots/{pipecat_bot_id}/speak", dependencies=[Depends(verify_auth)])
async def speak(pipecat_bot_id: str, req: SpeakRequest):
    bot = get_bot(pipecat_bot_id)
    await bot.queue_speech(req.text)
    return {"ok": True}


@app.delete("/bots/{pipecat_bot_id}", dependencies=[Depends(verify_auth)])
async def terminate_bot(pipecat_bot_id: str):
    bot = get_bot(pipecat_bot_id)
    await bot.terminate()

    task = _tasks.pop(pipecat_bot_id, None)
    if task is not None and not task.done():
        task.cancel()
    _bots.pop(pipecat_bot_id, None)

    return {"ok": True}


@app.get("/healthz")
async def healthz():
    return {"ok": True, "active_bots": len(_bots)}
