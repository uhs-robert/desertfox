import { create_config_store } from "../../src/background/config_store.ts";
import { create_config_service } from "../../src/background/config_main.ts";
import { create_services } from "../../src/background/services.ts";

// A config service with state of its own, built over whatever `browser` is when it runs. A test installs the fake browser first, and each call is one "background start".
export function fresh_config_service() {
  const services = create_services({ get_config: () => store.get_config() });
  const store = create_config_store(services);
  return create_config_service({ store, services });
}

export type ConfigService = ReturnType<typeof fresh_config_service>;
