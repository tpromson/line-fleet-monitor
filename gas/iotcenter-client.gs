/**
 * IoTcenter Client for Google Apps Script
 * ส่ง events และ heartbeat ไปยัง IoTcenter API
 *
 * วิธีใช้:
 *   1. ตั้งค่าใน Script Properties (File → Project Properties):
 *      IOTCENTER_API_URL  = https://your-backend-url.com
 *      IOTCENTER_API_KEY  = your-source-api-key
 *      IOTCENTER_DEVICE   = ชื่ออุปกรณ์ (optional)
 *   2. เรียกใช้:
 *      var iotCfg = getIoTcenterConfig();
 *      IoTcenter.init(iotCfg.apiUrl, iotCfg.apiKey, iotCfg.deviceName);
 */

var IoTcenter = (function() {
  'use strict';

  var _apiUrl = '';
  var _apiKey = '';
  var _deviceName = '';
  var _deviceType = '';

  function init(apiUrl, apiKey, deviceName, deviceType) {
    _apiUrl = apiUrl;
    _apiKey = apiKey;
    _deviceName = deviceName || '';
    _deviceType = deviceType || 'google_apps_script';
  }

  function _callApi(path, payload) {
    if (!_apiUrl || !_apiKey) {
      throw new Error('IoTcenter not initialized. Call IoTcenter.init(apiUrl, apiKey) first.');
    }

    var options = {
      method: 'POST',
      headers: {
        'X-API-Key': _apiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {
      var response = UrlFetchApp.fetch(_apiUrl + path, options);
      var status = response.getResponseCode();

      if (status === 201 || status === 200) {
        return JSON.parse(response.getContentText());
      }

      Logger.log('[IoTcenter] Error ' + status + ': ' + response.getContentText());
      return null;
    } catch (e) {
      Logger.log('[IoTcenter] Connection error: ' + e.toString());
      return null;
    }
  }

  function sendEvent(eventType, level, message, payload) {
    var data = {
      event_type: eventType,
      level: level || 'info',
      message: message || ''
    };

    if (payload) {
      data.payload = payload;
    }

    return _callApi('/api/iotcenter/events', data);
  }

  function sendHeartbeat(deviceName, deviceType, metadata) {
    var data = {
      device_name: deviceName || _deviceName,
      device_type: deviceType || _deviceType
    };

    if (metadata) {
      data.metadata = metadata;
    }

    return _callApi('/api/iotcenter/heartbeat', data);
  }

  return {
    init: init,
    sendEvent: sendEvent,
    sendHeartbeat: sendHeartbeat
  };
})();

// ============================================================
// CONFIG — ตั้งค่าใน Script Properties (File → Project Properties)
//   IOTCENTER_API_URL  = https://line-fleetbackend-production.up.railway.app
//   IOTCENTER_API_KEY  = (จาก IoTcenter Setup → Sources → API Key)
//   IOTCENTER_DEVICE   = TempBot
// ============================================================
function getIoTcenterConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    apiUrl: props.getProperty('IOTCENTER_API_URL') || 'https://line-fleetbackend-production.up.railway.app',
    apiKey: props.getProperty('IOTCENTER_API_KEY') || '',
    deviceName: props.getProperty('IOTCENTER_DEVICE') || 'TempBot',
    deviceType: 'google_apps_script'
  };
}

// ============================================================
// EXAMPLES — ลบหรือคอมเมนต์ออกเมื่อใช้งานจริง
// ============================================================

// ตัวอย่าง 1: ส่ง heartbeat ทุกครั้งที่ script ทำงาน
// function scheduledHeartbeat() {
//   var iotCfg = getIoTcenterConfig();
//   IoTcenter.init(iotCfg.apiUrl, iotCfg.apiKey, iotCfg.deviceName, iotCfg.deviceType);
//   IoTcenter.sendHeartbeat();
// }

// ตัวอย่าง 2: ส่ง alert เมื่ออุณหภูมิเกิน
// function checkTemperature() {
//   var iotCfg = getIoTcenterConfig();
//   IoTcenter.init(iotCfg.apiUrl, iotCfg.apiKey, iotCfg.deviceName, iotCfg.deviceType);
//
//   var temp = 28.5; // เปลี่ยนเป็นค่าจริงจาก sensor
//   var threshold = 8;
//
//   if (temp > threshold) {
//     IoTcenter.sendEvent(
//       'HIGH_TEMP',
//       'warning',
//       'อุณหภูมิตู้เย็นเกิน ' + threshold + '°C: ' + temp + '°C',
//       { temperature: temp, threshold: threshold, unit: 'celsius' }
//     );
//   } else {
//     IoTcenter.sendEvent(
//       'TEMP_OK',
//       'info',
//       'อุณหภูมิปกติ: ' + temp + '°C',
//       { temperature: temp }
//     );
//   }
//
//   IoTcenter.sendHeartbeat();
// }

// ตัวอย่าง 3: ส่ง daily report
// function dailyReport() {
//   var iotCfg = getIoTcenterConfig();
//   IoTcenter.init(iotCfg.apiUrl, iotCfg.apiKey, iotCfg.deviceName, iotCfg.deviceType);
//
//   IoTcenter.sendEvent(
//     'REPORT_GENERATED',
//     'info',
//     'Daily temperature report generated',
//     {
//       date: new Date().toISOString(),
//       reportType: 'temperature_summary',
//       recordsCount: 48
//     }
//   );
// }

// ตัวอย่าง 4: ส่ง error alert
// function onScriptError(errorMessage) {
//   var iotCfg = getIoTcenterConfig();
//   IoTcenter.init(iotCfg.apiUrl, iotCfg.apiKey, iotCfg.deviceName, iotCfg.deviceType);
//
//   IoTcenter.sendEvent(
//     'SCRIPT_ERROR',
//     'critical',
//     'Script error: ' + errorMessage,
//     { scriptName: iotCfg.deviceName, error: errorMessage }
//   );
// }
