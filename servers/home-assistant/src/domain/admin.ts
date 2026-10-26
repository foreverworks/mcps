/**
 * What only an administrator's token may do, so a token of any other user is
 * never sent where Home Assistant would answer 401: it counts every 401 as a
 * failed login, whatever the reason, and bans an address after a few.
 *
 * Read from Home Assistant's own source (the dev branch, 2026-10-26). Over
 * REST, POST /api/template is `@require_admin`; /api/config, /api/states,
 * /api/services, /api/history and /api/logbook are not. Over the WebSocket
 * API, auth/current_user and the area, floor, device and entity registries'
 * `list` commands are not. An action is admin-only when its integration
 * registers it with `async_register_admin_service`: every `reload`, and the
 * actions below. An integration that adds another later is learned when Home
 * Assistant first refuses it (infra/rest.ts) and is not sent again.
 */

/** The tools that need an administrator's token, and why. */
export const ADMIN_TOOLS: Readonly<Record<string, string>> = {
  render_template: "Home Assistant renders templates over its API only for administrators",
};

/** Integrations that register every action they have as admin-only. */
const ADMIN_DOMAINS: ReadonlySet<string> = new Set(["deconz", "hassio", "huawei_lte", "simplisafe", "synology_dsm"]);

const ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  "ai_task.clear_images", "backup.create", "backup.create_automatic", "cast.show_lovelace_view",
  "cloud.remote_connect", "cloud.remote_disconnect", "configurator.configure", "debugpy.start",
  "downloader.download_file", "file.read_file", "fritz.set_guest_wifi_password", "frontend.reload_themes",
  "frontend.set_theme", "homeassistant.check_config", "homeassistant.reload_all",
  "homeassistant.reload_config_entry", "homeassistant.reload_core_config",
  "homeassistant.reload_custom_templates", "homeassistant.restart", "homeassistant.set_location",
  "homeassistant.stop", "homematicip_cloud.dump_hap_config", "homematicip_cloud.reset_energy_counter",
  "homematicip_cloud.set_home_cooling_mode", "insteon.add_all_link", "insteon.add_default_links",
  "insteon.delete_all_link", "knx.event_register", "knx.exposure_register", "logger.set_default_level",
  "logger.set_level", "lovelace.reload_resources", "mijn_farmad_apotheek.order_medication",
  "monzo.deposit_into_pot", "monzo.withdraw_from_pot", "mqtt.dump", "mqtt.publish", "neopool.set_device_time",
  "nintendo_parental_controls.update_daily_restrictions", "nintendo_parental_controls.update_pin_code",
  "peblar.add_rfid_token", "peblar.add_vehicle_token", "peblar.authorize_charge_session",
  "peblar.delete_rfid_token", "peblar.delete_vehicle_token", "peblar.list_rfid_tokens",
  "peblar.list_vehicle_tokens", "portainer.prune_build_cache", "portainer.prune_images",
  "portainer.recreate_container", "profiler.dump_log_objects", "profiler.dump_sockets",
  "profiler.log_current_tasks", "profiler.log_event_loop_scheduled", "profiler.log_thread_frames",
  "profiler.lru_stats", "profiler.memory", "profiler.set_asyncio_debug", "profiler.start",
  "profiler.start_log_object_sources", "profiler.start_log_objects", "profiler.stop_log_object_sources",
  "profiler.stop_log_objects", "recorder.disable", "recorder.enable", "recorder.get_statistics",
  "recorder.purge", "recorder.purge_entities", "sofar.set_active_power_limit", "sofar.set_feed_in_limit",
  "sofar.set_passive_mode_power", "sofar.set_passive_mode_timeout", "tplink_omada.set_client_name",
  "unifiprotect.trigger_alarm_webhook", "zha.issue_zigbee_cluster_command", "zha.issue_zigbee_group_command",
  "zha.permit", "zha.remove", "zha.set_zigbee_cluster_attribute", "zha.warning_device_squawk",
  "zha.warning_device_warn",
]);

/** Whether Home Assistant runs this action only for an administrator. Pure. */
export const isAdminAction = (domain: string, service: string): boolean =>
  service === "reload" || ADMIN_DOMAINS.has(domain) || ADMIN_ACTIONS.has(`${domain}.${service}`);
