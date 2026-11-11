"""Loads a host script (they have no .py extension) as a module for the tests."""
import importlib.machinery
import importlib.util
import os

HOST_DIR = os.path.dirname(os.path.abspath(__file__))
HOST_PATH = os.path.join(HOST_DIR, "desertfox-host")


def load_host(script_name="desertfox-host"):
    module_name = script_name.replace("-", "_")
    loader = importlib.machinery.SourceFileLoader(module_name, os.path.join(HOST_DIR, script_name))
    spec = importlib.util.spec_from_loader(module_name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module
