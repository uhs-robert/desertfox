// A drop-in that throws at load, installed first in the key test's Firefox copy (firefox_copy.mjs). Firefox must start and stay usable, and the files after it must still load (p54_browser_module_locked.mjs).
Services.desertfox_key_test_throws_loaded = (Services.desertfox_key_test_throws_loaded ?? 0) + 1;
throw new Error("chrome_throws.js throws at load on purpose");
