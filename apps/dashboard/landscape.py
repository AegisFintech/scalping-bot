"""Stable native component; only trusted static assets and a sanitized view model."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import streamlit as st
from streamlit.components.v2 import component

from apps.dashboard.landscape_model import landscape_model

ASSETS = Path(__file__).with_name("assets")


@st.cache_resource(show_spinner=False)
def landscape_component() -> Any:
    return component(
        "scalper_landscape",
        html=(ASSETS / "landscape.html").read_text(),
        css=(ASSETS / "landscape.css").read_text(),
        js=(ASSETS / "landscape.mjs").read_text(),
    )


def render_landscape(snapshot: dict[str, Any], poll_state: str) -> None:
    landscape_component()(
        data=landscape_model(snapshot, poll_state, datetime.now(UTC)),
        key="landscape_desk",
        width="stretch",
        height="content",
    )
