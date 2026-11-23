/**
 * QR Scanner Module with Camera BarcodeDetector, Geolocation, and Testing Simulator
 * Fully self-contained for mobile phones, tablets, and desktop browsers.
 */
(function(window) {
  class AttendanceQRScanner {
    constructor() {
      this.videoElement = null;
      this.stream = null;
      this.isScanning = false;
      this.scanInterval = null;
      this.detector = null;
      this.onSuccessCallback = null;
      this.onErrorCallback = null;

      // Check if native BarcodeDetector API is available
      if ('BarcodeDetector' in window) {
        try {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch (e) {
          console.log('Native BarcodeDetector initialization fallback', e);
        }
      }
    }

    /**
     * Start live camera stream inside a given video DOM element
     */
    async startCamera(videoElement, onSuccess, onError) {
      this.videoElement = videoElement;
      this.onSuccessCallback = onSuccess;
      this.onErrorCallback = onError;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (onError) onError(new Error('Camera access is not supported by your browser. Please use the simulated QR scanner.'));
        return;
      }

      try {
        const constraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };

        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
        this.isScanning = true;

        this.startDetectionLoop();
      } catch (err) {
        console.error('Camera access error:', err);
        if (onError) onError(err);
      }
    }

    startDetectionLoop() {
      if (!this.detector || !this.isScanning) return;

      const scanStep = async () => {
        if (!this.isScanning || !this.videoElement) return;

        try {
          if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
            const barcodes = await this.detector.detect(this.videoElement);
            if (barcodes && barcodes.length > 0) {
              const detectedValue = barcodes[0].rawValue;
              if (detectedValue) {
                this.stopCamera();
                if (this.onSuccessCallback) this.onSuccessCallback(detectedValue);
                return;
              }
            }
          }
        } catch (e) {
          // Frame decode error or frame dropped
        }

        if (this.isScanning) {
          requestAnimationFrame(scanStep);
        }
      };

      requestAnimationFrame(scanStep);
    }

    stopCamera() {
      this.isScanning = false;
      if (this.scanInterval) {
        clearInterval(this.scanInterval);
        this.scanInterval = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      if (this.videoElement) {
        this.videoElement.srcObject = null;
      }
    }

    /**
     * Get Device GPS Geolocation with Campus fallback support
     */
    static async getCoordinates(useCampusCoords = false) {
      if (useCampusCoords) {
        // Krishna College of Arts and Science campus coordinates
        return {
          latitude: 10.9234,
          longitude: 78.0772,
          isSimulated: true
        };
      }

      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          return resolve({ latitude: 10.9234, longitude: 78.0772, isSimulated: true });
        }

        navigator.geolocation.getCurrentPosition(
          pos => {
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              isSimulated: false
            });
          },
          err => {
            console.warn('Geolocation failed or denied, using simulated campus location:', err.message);
            // Default to KCAS Karur campus coordinates
            resolve({
              latitude: 10.9234,
              longitude: 78.0772,
              isSimulated: true
            });
          },
          { timeout: 7000, enableHighAccuracy: true }
        );
      });
    }
  }

  window.AttendanceQRScanner = AttendanceQRScanner;
})(window);
