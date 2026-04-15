// Auto generated code by esphome
// ========== AUTO GENERATED INCLUDE BLOCK BEGIN ===========
#include "esphome.h"
using namespace esphome;
static logger::Logger *logger_logger_id;
using std::isnan;
using std::min;
using std::max;
#include <new>
using namespace light;
static web_server_base::WebServerBase *web_server_base_webserverbase_id;
static captive_portal::CaptivePortal *captive_portal_captiveportal_id;
static wifi::WiFiComponent *wifi_wificomponent_id;
static mdns::MDNSComponent *mdns_mdnscomponent_id;
static esphome::ESPHomeOTAComponent *esphome_esphomeotacomponent_id;
static web_server::WebServerOTAComponent *web_server_webserverotacomponent_id;
static preferences::IntervalSyncer *preferences_intervalsyncer_id;
static safe_mode::SafeModeComponent *safe_mode_safemodecomponent_id;
static api::APIServer *api_apiserver_id;
using namespace api;
static web_server::WebServer *web_server_webserver_id;
constexpr uint8_t ESPHOME_WEBSERVER_INDEX_HTML[174] PROGMEM = {60, 33, 68, 79, 67, 84, 89, 80, 69, 32, 104, 116, 109, 108, 62, 60, 104, 116, 109, 108, 62, 60, 104, 101, 97, 100, 62, 60, 109, 101, 116, 97, 32, 99, 104, 97, 114, 115, 101, 116, 61, 85, 84, 70, 45, 56, 62, 60, 108, 105, 110, 107, 32, 114, 101, 108, 61, 105, 99, 111, 110, 32, 104, 114, 101, 102, 61, 100, 97, 116, 97, 58, 62, 60, 47, 104, 101, 97, 100, 62, 60, 98, 111, 100, 121, 62, 60, 101, 115, 112, 45, 97, 112, 112, 62, 60, 47, 101, 115, 112, 45, 97, 112, 112, 62, 60, 115, 99, 114, 105, 112, 116, 32, 115, 114, 99, 61, 34, 104, 116, 116, 112, 115, 58, 47, 47, 111, 105, 46, 101, 115, 112, 104, 111, 109, 101, 46, 105, 111, 47, 118, 51, 47, 119, 119, 119, 46, 106, 115, 34, 62, 60, 47, 115, 99, 114, 105, 112, 116, 62, 60, 47, 98, 111, 100, 121, 62, 60, 47, 104, 116, 109, 108, 62};
constexpr size_t ESPHOME_WEBSERVER_INDEX_HTML_SIZE = 174;
using namespace json;
static esp32_rmt_led_strip::ESP32RMTLEDStripLightOutput *esp32_rmt_led_strip_esp32rmtledstriplightoutput_id;
static light::AddressableLightState *onboard_led;
static light::PulseLightEffect *light_pulselighteffect_id;
static light::RandomLightEffect *light_randomlighteffect_id;
static constexpr size_t ESPHOME_LOOPING_COMPONENT_COUNT = \
  (1 * HasLoopOverride<logger::Logger>::value) + \
  (1 * HasLoopOverride<captive_portal::CaptivePortal>::value) + \
  (1 * HasLoopOverride<wifi::WiFiComponent>::value) + \
  (1 * HasLoopOverride<mdns::MDNSComponent>::value) + \
  (1 * HasLoopOverride<esphome::ESPHomeOTAComponent>::value) + \
  (1 * HasLoopOverride<preferences::IntervalSyncer>::value) + \
  (1 * HasLoopOverride<safe_mode::SafeModeComponent>::value) + \
  (1 * HasLoopOverride<web_server::WebServerOTAComponent>::value) + \
  (1 * HasLoopOverride<api::APIServer>::value) + \
  (1 * HasLoopOverride<web_server::WebServer>::value) + \
  (1 * HasLoopOverride<light::AddressableLightState>::value) + \
  (1 * HasLoopOverride<esp32_rmt_led_strip::ESP32RMTLEDStripLightOutput>::value);
// ========== AUTO GENERATED INCLUDE BLOCK END ==========="

void setup() {
  // ========== AUTO GENERATED CODE BEGIN ===========
  // logger:
  //   id: logger_logger_id
  //   baud_rate: 115200
  //   tx_buffer_size: 512
  //   deassert_rts_dtr: false
  //   task_log_buffer_size: 768
  //   hardware_uart: USB_SERIAL_JTAG
  //   level: DEBUG
  //   logs: {}
  //   runtime_tag_levels: false
  logger_logger_id = new logger::Logger(115200, 768);
  logger_logger_id->create_pthread_key();
  logger_logger_id->set_uart_selection(logger::UART_SELECTION_USB_SERIAL_JTAG);
  logger_logger_id->pre_setup();
  logger_logger_id->set_log_level(ESPHOME_LOG_LEVEL_DEBUG);
  // network:
  //   enable_ipv6: false
  //   min_ipv6_addr_count: 0
  // esphome:
  //   name: air-purifier
  //   friendly_name: Air Purifier
  //   min_version: 2026.3.3
  //   build_path: build/air-purifier
  //   platformio_options: {}
  //   environment_variables: {}
  //   includes: []
  //   includes_c: []
  //   libraries: []
  //   name_add_mac_suffix: false
  //   debug_scheduler: false
  //   areas: []
  //   devices: []
  new (&App) Application();
  App.pre_setup("air-purifier", 12, "Air Purifier", 12);
  // light:
  logger_logger_id->set_component_source(LOG_STR("logger"));
  App.register_component_(logger_logger_id);
  // web_server_base:
  //   id: web_server_base_webserverbase_id
  web_server_base_webserverbase_id = new web_server_base::WebServerBase();
  web_server_base::global_web_server_base = web_server_base_webserverbase_id;
  // captive_portal:
  //   id: captive_portal_captiveportal_id
  //   web_server_base_id: web_server_base_webserverbase_id
  //   compression: gzip
  captive_portal_captiveportal_id = new captive_portal::CaptivePortal(web_server_base_webserverbase_id);
  captive_portal_captiveportal_id->set_component_source(LOG_STR("captive_portal"));
  App.register_component_(captive_portal_captiveportal_id);
  // wifi:
  //   manual_ip:
  //     static_ip: 192.168.68.238
  //     gateway: 192.168.68.1
  //     subnet: 255.255.255.0
  //     dns1: 0.0.0.0
  //     dns2: 0.0.0.0
  //   ap:
  //     ssid: Air-Purifier-Fallback
  //     id: wifi_wifiap_id
  //     ap_timeout: 90s
  //   id: wifi_wificomponent_id
  //   domain: .local
  //   reboot_timeout: 15min
  //   power_save_mode: LIGHT
  //   fast_connect: false
  //   enable_btm: false
  //   enable_rrm: false
  //   passive_scan: false
  //   enable_on_boot: true
  //   post_connect_roaming: true
  //   min_auth_mode: WPA2
  //   networks:
  //     - ssid: The Moores
  //       password: !secret 'wifi_password'
  //       id: wifi_wifiap_id_2
  //       priority: 0
  //   use_address: 192.168.68.238
  wifi_wificomponent_id = new wifi::WiFiComponent();
  wifi_wificomponent_id->set_use_address("192.168.68.238");
  wifi_wificomponent_id->init_sta(1);
  {
  wifi::WiFiAP wifi_wifiap_id_2 = wifi::WiFiAP();
  wifi_wifiap_id_2.set_ssid("The Moores");
  wifi_wifiap_id_2.set_password("zoeboots");
  wifi_wifiap_id_2.set_manual_ip(wifi::ManualIP{
      .static_ip = network::IPAddress(192, 168, 68, 238),
      .gateway = network::IPAddress(192, 168, 68, 1),
      .subnet = network::IPAddress(255, 255, 255, 0),
      .dns1 = network::IPAddress(0, 0, 0, 0),
      .dns2 = network::IPAddress(0, 0, 0, 0),
  });
  wifi_wifiap_id_2.set_priority(0);
  wifi_wificomponent_id->add_sta(wifi_wifiap_id_2);
  }
  {
  wifi::WiFiAP wifi_wifiap_id = wifi::WiFiAP();
  wifi_wifiap_id.set_ssid("Air-Purifier-Fallback");
  wifi_wificomponent_id->set_ap(wifi_wifiap_id);
  }
  wifi_wificomponent_id->set_ap_timeout(90000);
  wifi_wificomponent_id->set_reboot_timeout(900000);
  wifi_wificomponent_id->set_power_save_mode(wifi::WIFI_POWER_SAVE_LIGHT);
  wifi_wificomponent_id->set_min_auth_mode(wifi::WIFI_MIN_AUTH_MODE_WPA2);
  wifi_wificomponent_id->set_component_source(LOG_STR("wifi"));
  App.register_component_(wifi_wificomponent_id);
  // mdns:
  //   id: mdns_mdnscomponent_id
  //   disabled: false
  //   services: []
  mdns_mdnscomponent_id = new mdns::MDNSComponent();
  mdns_mdnscomponent_id->set_component_source(LOG_STR("mdns"));
  App.register_component_(mdns_mdnscomponent_id);
  // ota:
  // ota.esphome:
  //   platform: esphome
  //   id: esphome_esphomeotacomponent_id
  //   version: 2
  //   port: 3232
  esphome_esphomeotacomponent_id = new esphome::ESPHomeOTAComponent();
  esphome_esphomeotacomponent_id->set_port(3232);
  esphome_esphomeotacomponent_id->set_component_source(LOG_STR("esphome.ota"));
  App.register_component_(esphome_esphomeotacomponent_id);
  // ota.web_server:
  //   platform: web_server
  //   id: web_server_webserverotacomponent_id
  web_server_webserverotacomponent_id = new web_server::WebServerOTAComponent();
  // preferences:
  //   id: preferences_intervalsyncer_id
  //   flash_write_interval: 60s
  preferences_intervalsyncer_id = new preferences::IntervalSyncer();
  preferences_intervalsyncer_id->set_write_interval(60000);
  preferences_intervalsyncer_id->set_component_source(LOG_STR("preferences"));
  App.register_component_(preferences_intervalsyncer_id);
  // safe_mode:
  //   id: safe_mode_safemodecomponent_id
  //   boot_is_good_after: 1min
  //   disabled: false
  //   num_attempts: 10
  //   reboot_timeout: 5min
  safe_mode_safemodecomponent_id = new safe_mode::SafeModeComponent();
  safe_mode_safemodecomponent_id->set_component_source(LOG_STR("safe_mode"));
  App.register_component_(safe_mode_safemodecomponent_id);
  if (safe_mode_safemodecomponent_id->should_enter_safe_mode(10, 300000, 60000)) return;
  web_server_webserverotacomponent_id->set_component_source(LOG_STR("web_server.ota"));
  App.register_component_(web_server_webserverotacomponent_id);
  // api:
  //   id: api_apiserver_id
  //   port: 6053
  //   reboot_timeout: 15min
  //   batch_delay: 100ms
  //   custom_services: false
  //   homeassistant_services: false
  //   homeassistant_states: false
  //   listen_backlog: 4
  //   max_connections: 8
  //   max_send_queue: 8
  api_apiserver_id = new api::APIServer();
  api_apiserver_id->set_component_source(LOG_STR("api"));
  App.register_component_(api_apiserver_id);
  api_apiserver_id->set_port(6053);
  api_apiserver_id->set_reboot_timeout(900000);
  api_apiserver_id->set_batch_delay(100);
  api_apiserver_id->set_listen_backlog(4);
  api_apiserver_id->set_max_connections(8);
  // web_server:
  //   port: 80
  //   version: 3
  //   id: web_server_webserver_id
  //   enable_private_network_access: true
  //   web_server_base_id: web_server_base_webserverbase_id
  //   include_internal: false
  //   log: true
  //   compression: gzip
  //   css_url: ''
  //   js_url: https:oi.esphome.io/v3/www.js
  web_server_webserver_id = new web_server::WebServer(web_server_base_webserverbase_id);
  web_server_webserver_id->set_component_source(LOG_STR("web_server"));
  App.register_component_(web_server_webserver_id);
  web_server_base_webserverbase_id->set_port(80);
  web_server_webserver_id->set_expose_log(true);
  web_server_webserver_id->set_include_internal(false);
  // json:
  //   {}
  // esp32:
  //   board: esp32-c6-devkitc-1
  //   framework:
  //     type: esp-idf
  //     version: 5.5.3-1
  //     sdkconfig_options: {}
  //     log_level: ERROR
  //     advanced:
  //       compiler_optimization: SIZE
  //       enable_idf_experimental_features: false
  //       enable_lwip_assert: true
  //       ignore_efuse_custom_mac: false
  //       ignore_efuse_mac_crc: false
  //       enable_lwip_mdns_queries: true
  //       enable_lwip_bridge_interface: false
  //       enable_lwip_tcpip_core_locking: true
  //       enable_lwip_check_thread_safety: true
  //       disable_libc_locks_in_iram: true
  //       disable_vfs_support_termios: true
  //       disable_vfs_support_select: true
  //       disable_vfs_support_dir: true
  //       freertos_in_iram: false
  //       ringbuf_in_iram: false
  //       heap_in_iram: false
  //       execute_from_psram: false
  //       loop_task_stack_size: 8192
  //       enable_ota_rollback: true
  //       use_full_certificate_bundle: false
  //       include_builtin_idf_components: []
  //       enable_full_printf: false
  //       disable_debug_stubs: true
  //       disable_ocd_aware: true
  //       disable_usb_serial_jtag_secondary: true
  //       disable_dev_null_vfs: true
  //       disable_mbedtls_peer_cert: true
  //       disable_mbedtls_pkcs7: true
  //       disable_regi2c_in_iram: true
  //       disable_fatfs: true
  //     components: []
  //     platform_version: https:github.com/pioarduino/platform-espressif32/releases/download/55.03.37/platform-espressif32.zip
  //     source: pioarduino/framework-espidf@https:github.com/pioarduino/esp-idf/releases/download/v5.5.3.1/esp-idf-v5.5.3.1.tar.xz
  //   flash_size: 4MB
  //   variant: ESP32C6
  //   cpu_frequency: 160MHZ
  // light.esp32_rmt_led_strip:
  //   platform: esp32_rmt_led_strip
  //   id: onboard_led
  //   name: Onboard LED
  //   pin:
  //     number: 8
  //     mode:
  //       output: true
  //       input: false
  //       open_drain: false
  //       pullup: false
  //       pulldown: false
  //     id: esp32_esp32internalgpiopin_id
  //     inverted: false
  //     ignore_pin_validation_error: false
  //     ignore_strapping_warning: false
  //     drive_strength: 20.0
  //   num_leds: 1
  //   rgb_order: GRB
  //   chipset: WS2812
  //   default_transition_length: 500ms
  //   effects:
  //     - pulse:
  //         name: Breathe
  //         transition_length: 2s
  //         update_interval: 2s
  //         min_brightness: 0.0
  //         max_brightness: 1.0
  //       type_id: light_pulselighteffect_id
  //     - random:
  //         name: Random
  //         transition_length: 2s
  //         update_interval: 3s
  //       type_id: light_randomlighteffect_id
  //   disabled_by_default: false
  //   restore_mode: ALWAYS_OFF
  //   gamma_correct: 2.8
  //   flash_transition_length: 0s
  //   output_id: esp32_rmt_led_strip_esp32rmtledstriplightoutput_id
  //   rmt_symbols: 96
  //   is_rgbw: false
  //   is_wrgb: false
  //   use_psram: true
  //   reset_high: 0us
  //   reset_low: 0us
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id = new esp32_rmt_led_strip::ESP32RMTLEDStripLightOutput();
  onboard_led = new light::AddressableLightState(esp32_rmt_led_strip_esp32rmtledstriplightoutput_id);
  App.register_light(onboard_led);
  onboard_led->set_component_source(LOG_STR("light"));
  App.register_component_(onboard_led);
  onboard_led->set_restore_mode(light::LIGHT_ALWAYS_OFF);
  onboard_led->set_default_transition_length(500);
  onboard_led->set_flash_transition_length(0);
  onboard_led->set_gamma_correct(2.8f);
  static constexpr uint16_t gamma_2_8_fwd[] PROGMEM = {0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x02, 0x03, 0x04, 0x06, 0x08, 0x0A, 0x0D, 0x10, 0x13, 0x18, 0x1C, 0x21, 0x27, 0x2E, 0x35, 0x3C, 0x45, 0x4E, 0x58, 0x62, 0x6E, 0x7A, 0x87, 0x95, 0xA4, 0xB3, 0xC4, 0xD6, 0xE8, 0xFC, 0x111, 0x127, 0x13D, 0x155, 0x16E, 0x189, 0x1A4, 0x1C1, 0x1DE, 0x1FE, 0x21E, 0x23F, 0x262, 0x287, 0x2AC, 0x2D3, 0x2FC, 0x326, 0x351, 0x37E, 0x3AC, 0x3DC, 0x40D, 0x440, 0x474, 0x4AA, 0x4E2, 0x51B, 0x556, 0x593, 0x5D1, 0x611, 0x653, 0x696, 0x6DC, 0x723, 0x76C, 0x7B7, 0x803, 0x852, 0x8A2, 0x8F5, 0x949, 0x99F, 0x9F8, 0xA52, 0xAAE, 0xB0D, 0xB6D, 0xBD0, 0xC34, 0xC9B, 0xD04, 0xD6F, 0xDDC, 0xE4C, 0xEBE, 0xF32, 0xFA8, 0x1020, 0x109B, 0x1118, 0x1198, 0x121A, 0x129E, 0x1325, 0x13AE, 0x1439, 0x14C7, 0x1558, 0x15EB, 0x1680, 0x1718, 0x17B3, 0x1850, 0x18F0, 0x1992, 0x1A37, 0x1ADF, 0x1B89, 0x1C36, 0x1CE5, 0x1D98, 0x1E4D, 0x1F05, 0x1FC0, 0x207D, 0x213D, 0x2200, 0x22C6, 0x238F, 0x245B, 0x252A, 0x25FB, 0x26D0, 0x27A7, 0x2882, 0x295F, 0x2A40, 0x2B23, 0x2C0A, 0x2CF3, 0x2DE0, 0x2ED0, 0x2FC3, 0x30B9, 0x31B2, 0x32AF, 0x33AE, 0x34B1, 0x35B7, 0x36C1, 0x37CD, 0x38DD, 0x39F1, 0x3B07, 0x3C21, 0x3D3E, 0x3E5F, 0x3F83, 0x40AA, 0x41D5, 0x4303, 0x4435, 0x456A, 0x46A3, 0x47DF, 0x491F, 0x4A62, 0x4BA9, 0x4CF4, 0x4E42, 0x4F94, 0x50E9, 0x5242, 0x539F, 0x54FF, 0x5663, 0x57CB, 0x5936, 0x5AA6, 0x5C19, 0x5D90, 0x5F0A, 0x6089, 0x620B, 0x6391, 0x651C, 0x66AA, 0x683B, 0x69D1, 0x6B6B, 0x6D09, 0x6EAA, 0x7050, 0x71FA, 0x73A8, 0x7559, 0x770F, 0x78C9, 0x7A87, 0x7C4A, 0x7E10, 0x7FDA, 0x81A9, 0x837C, 0x8553, 0x872E, 0x890D, 0x8AF1, 0x8CD9, 0x8EC5, 0x90B6, 0x92AB, 0x94A4, 0x96A1, 0x98A3, 0x9AA9, 0x9CB4, 0x9EC3, 0xA0D7, 0xA2EF, 0xA50B, 0xA72C, 0xA952, 0xAB7B, 0xADAA, 0xAFDD, 0xB214, 0xB451, 0xB691, 0xB8D7, 0xBB21, 0xBD6F, 0xBFC3, 0xC21B, 0xC477, 0xC6D9, 0xC93F, 0xCBAA, 0xCE19, 0xD08E, 0xD307, 0xD585, 0xD807, 0xDA8F, 0xDD1C, 0xDFAD, 0xE243, 0xE4DE, 0xE77E, 0xEA23, 0xECCD, 0xEF7C, 0xF230, 0xF4E9, 0xF7A7, 0xFA6A, 0xFD32, 0xFFFF};
  onboard_led->set_gamma_table(gamma_2_8_fwd);
  light_pulselighteffect_id = new light::PulseLightEffect("Breathe");
  light_pulselighteffect_id->set_transition_on_length(2000);
  light_pulselighteffect_id->set_transition_off_length(2000);
  light_pulselighteffect_id->set_update_interval(2000);
  light_pulselighteffect_id->set_min_max_brightness(0.0f, 1.0f);
  light_randomlighteffect_id = new light::RandomLightEffect("Random");
  light_randomlighteffect_id->set_transition_length(2000);
  light_randomlighteffect_id->set_update_interval(3000);
  onboard_led->add_effects({light_pulselighteffect_id, light_randomlighteffect_id});
  onboard_led->configure_entity_("Onboard LED", 1628604608, 0);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_component_source(LOG_STR("esp32_rmt_led_strip.light"));
  App.register_component_(esp32_rmt_led_strip_esp32rmtledstriplightoutput_id);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_num_leds(1);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_pin(8);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_led_params(400, 1000, 1000, 400, 0, 0);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_rgb_order(esp32_rmt_led_strip::ORDER_GRB);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_is_rgbw(false);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_is_wrgb(false);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_use_psram(true);
  esp32_rmt_led_strip_esp32rmtledstriplightoutput_id->set_rmt_symbols(96);
  // md5:
  // sha256:
  //   {}
  // socket:
  //   implementation: bsd_sockets
  // web_server_idf:
  //   {}
  App.looping_components_.init(ESPHOME_LOOPING_COMPONENT_COUNT);
  // =========== AUTO GENERATED CODE END ============
  App.setup();
}

void loop() {
  App.loop();
}
