# Jarvis side assistant

The UI follows the supplied reference: a right-hand panel, Chat/Voice switch, amber listening orb, transcript and voice controls. The implementation is CSS/JavaScript, not a generated screenshot.

Tap the Jarvis button, select a school portion, then type or press Speak. Voice is available only when an appropriately permitted AI gateway is configured and the browser supports recognition. Permission denial/unsupported browsers fall back to typed chat. End/Close stops recognition and speech synthesis; profile/lesson changes clear the assistant's local context.

This is turn-based voice assistance, not a live realtime-audio API or wake-word listener. The underlying browser may use a remote recognition service and may need internet access. Do not describe it as fully offline/on-device. Supported language choices are English, Arabic, French and Hindi; actual voices/recognition vary by device.

References checked October 24, 2026:
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API

The current default AI setting is disabled, so the preview demonstrates the panel while explicitly saying Tutor connection pending. No live Jarvis answer or microphone recording was performed in the build environment.
