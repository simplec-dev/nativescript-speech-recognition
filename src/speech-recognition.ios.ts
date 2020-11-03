import { SpeechRecognitionApi, SpeechRecognitionOptions } from "./speech-recognition.common";
import { device } from "tns-core-modules/platform";

export class SpeechRecognition implements SpeechRecognitionApi {

  private recognitionRequest: SFSpeechAudioBufferRecognitionRequest = null;
  private audioEngine: AVAudioEngine = null;
  private speechRecognizer: SFSpeechRecognizer = null;
  private recognitionTask: SFSpeechRecognitionTask = null;
  private inputNode: AVAudioInputNode = null;
  private audioSession: AVAudioSession = null;

  constructor() {
    this.audioEngine = AVAudioEngine.new();
  }

  available(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      resolve(parseInt(device.osVersion) >= 10);
    });
  }

  requestPermission(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      SFSpeechRecognizer.requestAuthorization((status: SFSpeechRecognizerAuthorizationStatus) => {
        if (status !== SFSpeechRecognizerAuthorizationStatus.Authorized) {
          resolve(false);
          return;
        }
        AVAudioSession.sharedInstance().requestRecordPermission((granted: boolean) => {
          resolve(granted);
        });
      });
    });
  }

  startListening(options: SpeechRecognitionOptions): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const locale = NSLocale.alloc().initWithLocaleIdentifier(options.locale ? options.locale : device.language);
      this.speechRecognizer = SFSpeechRecognizer.alloc().initWithLocale(locale);

      if (this.recognitionTask !== null) {
        this.recognitionTask.cancel();
        this.recognitionTask = null;
      }

      SFSpeechRecognizer.requestAuthorization((status: SFSpeechRecognizerAuthorizationStatus) => {
        if (status !== SFSpeechRecognizerAuthorizationStatus.Authorized) {
          options.onError && options.onError("Not authorized");
          reject("Not authorized");
          return;
        }

        this.audioSession = AVAudioSession.sharedInstance();
        this.audioSession.setCategoryError(AVAudioSessionCategoryRecord);
        this.audioSession.setModeError(AVAudioSessionModeMeasurement);
        this.audioSession.setActiveWithOptionsError(true, AVAudioSessionSetActiveOptions.NotifyOthersOnDeactivation);

        this.recognitionRequest = SFSpeechAudioBufferRecognitionRequest.new();
        if (!this.recognitionRequest) {
          options.onError && options.onError("Unable to create an SFSpeechAudioBufferRecognitionRequest object");
          reject("Unable to create an SFSpeechAudioBufferRecognitionRequest object");
          return;
        }

        this.inputNode = this.audioEngine.inputNode;
        if (!this.inputNode) {
          options.onError && options.onError("Audio engine has no input node");
          reject("Audio engine has no input node");
          return;
        }

        this.recognitionRequest.shouldReportPartialResults = options.returnPartialResults;

        this.recognitionTask = this.speechRecognizer.recognitionTaskWithRequestResultHandler(
            this.recognitionRequest,
            (result: SFSpeechRecognitionResult, error: NSError) => {
              if (result !== null) {
                options.onResult({
                  finished: result.final,
                  text: result.bestTranscription.formattedString
                });
              }

              if (error !== null || (result !== null && result.final)) {
                console.log("speech rec startlistening error: " + error);
                //console.log("speech rec startlistening result: " + result);
                this.audioEngine.stop();
                this.inputNode.removeTapOnBus(0);
                this.audioSession.setCategoryError(AVAudioSessionCategoryPlayAndRecord);
                this.audioSession.setModeError(AVAudioSessionModeDefault);
                this.recognitionRequest = null;
                this.recognitionTask = null;
              }

              if (error !== null) {
                console.log("error in handler: " + error.localizedDescription);
                options.onError && options.onError(error.localizedDescription);
                // no need to 'reject' as the promise has been resolved by now anyway
              }
            });

        let that = this;

        this.inputNode.removeTapOnBus(0);
        var recordingFormat = this.inputNode.outputFormatForBus(0);
        //recordingFormat.sampleRate = AVAudioSession.sharedInstance().sampleRate
        let desiredSampleRate = recordingFormat.sampleRate;
        let actualSampleRate = AVAudioSession.sharedInstance().sampleRate;
        if (desiredSampleRate != actualSampleRate) {
            AVAudioSession.sharedInstance().setPreferredSampleRateError(desiredSampleRate);
            //recordingFormat = AVAudioFormat.alloc().initStandardFormatWithSampleRateChannels(actualSampleRate, 1);
        }
        console.log("###########################recordingformat samplerate: " + recordingFormat.sampleRate);
        console.log("###########################sharedinstance samplerate: " + AVAudioSession.sharedInstance().sampleRate);
        try {
            this.inputNode.installTapOnBusBufferSizeFormatBlock(0, 1024, recordingFormat, (buffer: AVAudioPCMBuffer, when: AVAudioTime) => {
              if (that.recognitionRequest != null) {
                that.recognitionRequest.appendAudioPCMBuffer(buffer);
              }
            });
    
            this.audioEngine.prepare();
            resolve(this.audioEngine.startAndReturnError());
        } catch (e) {
            console.error(e);
            reject("Error tapping audio buffer: "+e);
        }
      });
    });
  }

  stopListening(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.audioEngine.running) {
        reject("Not running");
        return;
      }

      this.audioEngine.stop();
      this.recognitionRequest.endAudio();
      this.audioSession.setCategoryError(AVAudioSessionCategoryPlayback);
      this.audioSession.setModeError(AVAudioSessionModeDefault);
      this.speechRecognizer = null;
      this.recognitionTask = null;
      resolve();
    });
  }
}
