/**
 * Daily sensor summary -> Backend -> MOPH Notify
 *
 * Script Properties:
 *   SENSOR_SUMMARY_BACKEND_URL = https://your-backend.example.com
 *   SENSOR_SUMMARY_API_KEY     = shared key configured on the backend
 *   SENSOR_SUMMARY_ORGANIZATION_ID = Organization ID allowed to send MOPH Notify
 *
 * Copy the existing sensor list into MOPH_SUMMARY_SENSORS below.
 * This script intentionally has no LINE Access Token or MOPH Client Secret.
 */

var MOPH_SUMMARY_SENSORS = [
  // { name: "01_ตู้เย็นคลัง ตู้แช่ 3 ประตู", id: "SPREADSHEET_ID" },
  // { name: "02_ตู้เย็นคลังวัคซีน", id: "SPREADSHEET_ID" },
];

var MOPH_SUMMARY_TIME_COL = 1;
var MOPH_SUMMARY_ALLOWED_DELAY_MINUTES = 40;

function getMophSummaryConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    backendUrl: (props.getProperty('SENSOR_SUMMARY_BACKEND_URL') || '').replace(/\/$/, ''),
    apiKey: props.getProperty('SENSOR_SUMMARY_API_KEY') || '',
    organizationId: props.getProperty('SENSOR_SUMMARY_ORGANIZATION_ID') || '',
  };
}

function sendSensorSummaryToMoph(message) {
  var config = getMophSummaryConfig();
  if (!config.backendUrl || !config.apiKey) {
    Logger.log('[MOPH Summary] Missing SENSOR_SUMMARY_BACKEND_URL or SENSOR_SUMMARY_API_KEY');
    return false;
  }

  try {
    var response = UrlFetchApp.fetch(config.backendUrl + '/api/notify/sensor-summary', {
      method: 'post',
      contentType: 'application/json',
    headers: {
      'X-Summary-Key': config.apiKey,
      'X-Organization-ID': config.organizationId,
    },
      payload: JSON.stringify({ message: message }),
      muteHttpExceptions: true,
    });

    var status = response.getResponseCode();
    Logger.log('[MOPH Summary] Backend response ' + status + ': ' + response.getContentText());
    return status === 200;
  } catch (e) {
    Logger.log('[MOPH Summary] Connection error: ' + e.toString());
    return false;
  }
}

function sendDailySensorStatusMoph() {
  var onlineCount = 0;
  var offlineSensors = [];
  var errorSensors = [];
  var now = new Date();

  for (var i = 0; i < MOPH_SUMMARY_SENSORS.length; i++) {
    var sensor = MOPH_SUMMARY_SENSORS[i];

    try {
      var spreadsheet = SpreadsheetApp.openById(sensor.id);
      var sheet = spreadsheet.getSheets()[0];
      var lastRow = sheet.getLastRow();

      if (lastRow < 2) {
        offlineSensors.push('📍 ' + sensor.name + '\n└ ⚠️ ไม่มีข้อมูล');
        continue;
      }

      var lastDate = mophSummaryParseDate(sheet.getRange(lastRow, MOPH_SUMMARY_TIME_COL).getValue());
      if (isNaN(lastDate.getTime())) {
        errorSensors.push('📍 ' + sensor.name + ' (รูปแบบเวลาไม่ถูกต้อง)');
        continue;
      }

      var diffInMinutes = (now.getTime() - lastDate.getTime()) / (1000 * 60);
      Logger.log('[MOPH Summary] ' + sensor.name + ' | age: ' + diffInMinutes.toFixed(2) + ' minutes');

      if (diffInMinutes > MOPH_SUMMARY_ALLOWED_DELAY_MINUTES) {
        offlineSensors.push(
          '📍 ' + sensor.name + '\n' +
          '└ ⏱️ ล่าสุด: ' + Utilities.formatDate(lastDate, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + ' น.'
        );
      } else {
        onlineCount++;
      }
    } catch (e) {
      errorSensors.push('📍 ' + sensor.name + ' (เปิดไฟล์ไม่ได้)');
      Logger.log('[MOPH Summary] Failed to read ' + sensor.name + ': ' + e.toString());
    }
  }

  var totalSensors = MOPH_SUMMARY_SENSORS.length;
  var message = '📊 สรุปสถานะ Sensor ประจำวัน\n' +
    'เช็คเมื่อ: ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + '\n' +
    '---------------------------\n' +
    '🟢 ออนไลน์: ' + onlineCount + '/' + totalSensors + ' อุปกรณ์\n' +
    '🔴 ออฟไลน์: ' + offlineSensors.length + ' อุปกรณ์';

  if (offlineSensors.length > 0) {
    message += '\n\n⚠️ รายชื่ออุปกรณ์ที่ Offline:\n' + offlineSensors.join('\n\n');
  }

  if (errorSensors.length > 0) {
    message += '\n\n❌ พบข้อผิดพลาดในการตรวจสอบ:\n' + errorSensors.join('\n');
  }

  return sendSensorSummaryToMoph(message);
}

function mophSummaryParseDate(value) {
  if (!value) return new Date(NaN);
  if (value instanceof Date) return value;

  var text = String(value).trim().replace(/-/g, '/');
  var match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
  }

  return new Date(text);
}
