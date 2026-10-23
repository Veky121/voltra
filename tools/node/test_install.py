"""Compatibility test entry point for the versioned release installer."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[1] / "install" / "test_node.py"), run_name="__main__")
