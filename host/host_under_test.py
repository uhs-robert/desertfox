"""Loads the host script (it has no .py extension) as a module for the tests."""
import importlib.machinery
import importlib.util
import os

HOST_DIR = os.path.dirname(os.path.abspath(__file__))
HOST_PATH = os.path.join(HOST_DIR, "desertfox-host")


def load_host():
    loader = importlib.machinery.SourceFileLoader("desertfox_host", HOST_PATH)
    spec = importlib.util.spec_from_loader("desertfox_host", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module
