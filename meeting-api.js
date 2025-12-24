/**
 * 会议助手 API 模块
 * 定义与后台交互的接口
 */

// API 基础配置（后续根据实际后台地址调整）
const API_BASE_URL = 'https://chat.ecnu.edu.cn/api/meeting';

/**
 * 会议 API 接口定义
 * 
 * 接口规格：
 * 1. POST /meeting/create - 创建会议
 *    请求: { userId: string, title?: string }
 *    响应: { meetingId: string, status: 'created' }
 * 
 * 2. POST /meeting/{id}/audio - 提交音频片段
 *    请求: FormData { audio: Blob, sequence: number, timestamp: number }
 *    响应: { speaker?: string, transcript?: string, summary?: string }
 * 
 * 3. POST /meeting/{id}/end - 结束会议
 *    请求: {}
 *    响应: { finalSummary: string, duration: number }
 */

class MeetingAPI {
  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.meetingId = null;
  }

  /**
   * 创建会议
   * @param {string} userId 用户ID
   * @param {string} title 会议标题（可选）
   * @returns {Promise<{meetingId: string, status: string}>}
   */
  async createMeeting(userId, title = '') {
    try {
      const response = await fetch(`${this.baseUrl}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, title }),
        credentials: 'include' // 携带 cookie
      });

      if (!response.ok) {
        throw new Error(`创建会议失败: ${response.status}`);
      }

      const data = await response.json();
      this.meetingId = data.meetingId;
      return data;
    } catch (error) {
      console.error('[MeetingAPI] 创建会议失败:', error);
      throw error;
    }
  }

  /**
   * 提交音频片段
   * @param {Blob} audioBlob 音频数据
   * @param {number} sequence 片段序号
   * @param {number} timestamp 时间戳
   * @returns {Promise<{speaker?: string, transcript?: string, summary?: string}>}
   */
  async submitAudio(audioBlob, sequence, timestamp) {
    if (!this.meetingId) {
      throw new Error('会议未创建');
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, `audio_${sequence}.webm`);
      formData.append('sequence', sequence.toString());
      formData.append('timestamp', timestamp.toString());

      const response = await fetch(`${this.baseUrl}/${this.meetingId}/audio`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`提交音频失败: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[MeetingAPI] 提交音频失败:', error);
      throw error;
    }
  }

  /**
   * 结束会议
   * @returns {Promise<{finalSummary: string, duration: number}>}
   */
  async endMeeting() {
    if (!this.meetingId) {
      throw new Error('会议未创建');
    }

    try {
      const response = await fetch(`${this.baseUrl}/${this.meetingId}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`结束会议失败: ${response.status}`);
      }

      const data = await response.json();
      this.meetingId = null;
      return data;
    } catch (error) {
      console.error('[MeetingAPI] 结束会议失败:', error);
      throw error;
    }
  }

  /**
   * 获取当前会议ID
   */
  getMeetingId() {
    return this.meetingId;
  }

  /**
   * 设置API基础地址
   */
  setBaseUrl(url) {
    this.baseUrl = url;
  }
}

module.exports = { MeetingAPI, API_BASE_URL };

