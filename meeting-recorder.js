/**
 * 会议录音模块
 * 负责麦克风和系统音频的采集、混合、分片
 */

const { desktopCapturer } = require('electron');

class MeetingRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioContext = null;
    this.micStream = null;
    this.systemStream = null;
    this.mixedStream = null;
    this.audioChunks = [];
    this.sequence = 0;
    this.isRecording = false;
    this.onAudioChunk = null; // 回调：(blob, sequence, timestamp) => void
    this.onError = null; // 回调：(error) => void
    
    // 配置
    this.chunkInterval = 5000; // 5秒分片
    this.mimeType = 'audio/webm;codecs=opus';
  }

  /**
   * 获取麦克风音频流
   */
  async getMicrophoneStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        },
        video: false
      });
      console.log('[MeetingRecorder] 麦克风权限获取成功');
      return stream;
    } catch (error) {
      console.error('[MeetingRecorder] 麦克风权限获取失败:', error);
      throw new Error('无法获取麦克风权限: ' + error.message);
    }
  }

  /**
   * 获取系统音频流（需要屏幕共享权限）
   */
  async getSystemAudioStream() {
    try {
      // 获取屏幕源
      const sources = await desktopCapturer.getSources({ 
        types: ['screen'],
        fetchWindowIcons: false
      });

      if (sources.length === 0) {
        throw new Error('没有可用的屏幕源');
      }

      // 使用第一个屏幕源获取系统音频
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0].id
          }
        },
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sources[0].id,
            maxWidth: 1,
            maxHeight: 1,
            maxFrameRate: 1
          }
        }
      });

      // 只保留音频轨道
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('无法获取系统音频');
      }

      // 停止视频轨道
      stream.getVideoTracks().forEach(track => track.stop());

      console.log('[MeetingRecorder] 系统音频获取成功');
      return new MediaStream(audioTracks);
    } catch (error) {
      console.error('[MeetingRecorder] 系统音频获取失败:', error);
      // 系统音频获取失败不是致命错误，返回 null
      return null;
    }
  }

  /**
   * 混合多个音频流
   */
  mixAudioStreams(streams) {
    // 过滤掉 null 的流
    const validStreams = streams.filter(s => s !== null);
    
    if (validStreams.length === 0) {
      throw new Error('没有可用的音频流');
    }

    if (validStreams.length === 1) {
      return validStreams[0];
    }

    // 创建 AudioContext 进行混音
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    const destination = this.audioContext.createMediaStreamDestination();

    validStreams.forEach(stream => {
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(destination);
    });

    console.log('[MeetingRecorder] 音频流混合完成，共', validStreams.length, '个源');
    return destination.stream;
  }

  /**
   * 开始录音
   * @param {Object} options 选项
   * @param {boolean} options.includeMic 是否包含麦克风
   * @param {boolean} options.includeSystem 是否包含系统音频
   */
  async start(options = { includeMic: true, includeSystem: true }) {
    if (this.isRecording) {
      throw new Error('录音已在进行中');
    }

    try {
      const streams = [];

      // 获取麦克风
      if (options.includeMic) {
        this.micStream = await this.getMicrophoneStream();
        streams.push(this.micStream);
      }

      // 获取系统音频
      if (options.includeSystem) {
        this.systemStream = await this.getSystemAudioStream();
        if (this.systemStream) {
          streams.push(this.systemStream);
        }
      }

      // 混合音频流
      this.mixedStream = this.mixAudioStreams(streams);

      // 创建 MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.mixedStream, {
        mimeType: this.mimeType,
        audioBitsPerSecond: 64000
      });

      this.sequence = 0;
      this.audioChunks = [];

      // 数据可用时的处理
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.sequence++;
          const timestamp = Date.now();
          
          console.log(`[MeetingRecorder] 音频片段 #${this.sequence}, 大小: ${event.data.size} bytes`);
          
          if (this.onAudioChunk) {
            this.onAudioChunk(event.data, this.sequence, timestamp);
          }
        }
      };

      // 错误处理
      this.mediaRecorder.onerror = (event) => {
        console.error('[MeetingRecorder] 录音错误:', event.error);
        if (this.onError) {
          this.onError(event.error);
        }
      };

      // 开始录音，每 5 秒生成一个片段
      this.mediaRecorder.start(this.chunkInterval);
      this.isRecording = true;

      console.log('[MeetingRecorder] 录音开始');
      return { success: true };
    } catch (error) {
      console.error('[MeetingRecorder] 启动录音失败:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * 停止录音
   */
  async stop() {
    if (!this.isRecording) {
      return { success: true };
    }

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        console.log('[MeetingRecorder] 录音停止');
        this.cleanup();
        resolve({ success: true });
      };

      this.mediaRecorder.stop();
      this.isRecording = false;
    });
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }

    if (this.systemStream) {
      this.systemStream.getTracks().forEach(track => track.stop());
      this.systemStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mixedStream = null;
    this.mediaRecorder = null;
    this.isRecording = false;
  }

  /**
   * 获取录音状态
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      sequence: this.sequence
    };
  }
}

module.exports = { MeetingRecorder };

