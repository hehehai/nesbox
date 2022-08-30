import {
  GemElement,
  html,
  adoptedStyle,
  customElement,
  createCSSSheet,
  css,
  createStore,
  connectStore,
  updateStore,
} from '@mantou/gem';

import { configure } from 'src/configure';
import { icons } from 'src/icons';
import { theme } from 'src/theme';
import { sendVoiceMsg } from 'src/services/api';
import { events, VoiceSingalEvent } from 'src/constants';
import { logger } from 'src/logger';
import { ScVoiceMsgKind } from 'src/generated/graphql';

import 'duoyun-ui/elements/use';

const style = createCSSSheet(css`
  :host {
    display: contents;
  }
  .icon {
    width: 1.3em;
    padding: 0.2em;
    border-radius: ${theme.smallRound};
  }
  .icon:hover {
    background: ${theme.lightBackgroundColor};
  }
`);

export const voiceStore = createStore<{ audioLevel: Record<number, number> }>({
  audioLevel: {},
});

type State = {
  joined: boolean;
  senderTrackIds: number[];
};

/**
 * @customElement m-room-voice
 */
@customElement('m-room-voice')
@adoptedStyle(style)
@connectStore(configure)
export class MVoiceRoomElement extends GemElement<State> {
  state: State = {
    joined: false,
    senderTrackIds: [],
  };

  #toggleVoice = () => {
    this.setState({ joined: !this.state.joined });
  };

  #closeVoice = () => this.setState({ joined: false });

  #audioEle = document.createElement('audio');

  mounted = () => {
    this.effect(
      ([roomId]) => {
        if (roomId && this.state.joined) {
          const peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun3.l.google.com:19302' }],
          });
          logger.info('RTCPeerConnection', peerConnection);

          let userMediaStream: null | MediaStream = null;
          // https://github.com/tauri-apps/tauri/issues/5039
          navigator.mediaDevices?.getUserMedia({ audio: { channelCount: 1 } }).then(async (stream) => {
            userMediaStream = stream;
            if (peerConnection.signalingState === 'closed') return;
            stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
            await peerConnection.setLocalDescription(await peerConnection.createOffer());
            sendVoiceMsg(ScVoiceMsgKind.Offer, peerConnection.localDescription!).catch(this.#closeVoice);
          });

          peerConnection.addEventListener('iceconnectionstatechange', () => {
            logger.info(`voice iceConnectionState ${peerConnection.iceConnectionState}`);
            if (
              peerConnection.iceConnectionState === 'disconnected' ||
              peerConnection.iceConnectionState === 'failed' ||
              peerConnection.iceConnectionState === 'closed'
            ) {
              this.#closeVoice();
            }
          });

          peerConnection.addEventListener('track', ({ streams }) => {
            logger.info(
              `voice track`,
              streams.flatMap((s) => s.getTracks()),
            );
            this.#audioEle.srcObject = streams[0];
            this.#audioEle.play().catch(this.#closeVoice);
            streams[0].onremovetrack = ({ track }) => {
              updateStore(voiceStore, { audioLevel: { ...voiceStore.audioLevel, [track.id]: undefined } });
            };
          });

          peerConnection.addEventListener('icecandidate', ({ candidate }) => {
            candidate &&
              sendVoiceMsg(ScVoiceMsgKind.Ice, candidate).catch(() => {
                //
              });
          });

          peerConnection.addEventListener('icecandidateerror', (event) => {
            logger.error(event);
          });

          const handleVoiceMsg = async ({ detail }: CustomEvent<VoiceSingalEvent>) => {
            if (roomId !== detail.roomId) return;
            if ('candidate' in detail.singal) {
              peerConnection.addIceCandidate(new RTCIceCandidate(detail.singal)).catch(this.#closeVoice);
            }
            if ('type' in detail.singal) {
              this.setState({ senderTrackIds: detail.singal.senderTrackIds.map(Number) });
              const sdp = new RTCSessionDescription(detail.singal);
              await peerConnection.setRemoteDescription(sdp);
              if (sdp.type === 'offer') {
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                sendVoiceMsg(ScVoiceMsgKind.Answer, peerConnection.localDescription!).catch(this.#closeVoice);
              }
            }
          };

          window.addEventListener(events.VOICE_SINGAL, handleVoiceMsg);

          const intervalTimer = setInterval(async () => {
            if (peerConnection.iceConnectionState !== 'connected') return;
            peerConnection.getReceivers().map(async ({ track }, i) => {
              const stats = [...(await peerConnection.getStats(track))];
              // https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats
              const inboundRtp = stats.find(([_, stat]) => stat.type === 'inbound-rtp')?.[1];
              const userId = this.state.senderTrackIds[i];
              if (inboundRtp) {
                updateStore(voiceStore, {
                  audioLevel: { ...voiceStore.audioLevel, [userId]: inboundRtp.audioLevel || 0 },
                });
              }
            });
            peerConnection.getSenders().map(async ({ track }) => {
              const stats = [...(await peerConnection.getStats(track))];
              const mediaSource = stats.find(([_, stat]) => stat.type === 'media-source')?.[1];
              if (mediaSource) {
                // Safari not support
                updateStore(voiceStore, {
                  audioLevel: { ...voiceStore.audioLevel, [configure.user!.id]: mediaSource.audioLevel || 0 },
                });
              }
            });
          }, 60);

          return () => {
            updateStore(voiceStore, { audioLevel: {} });
            clearInterval(intervalTimer);
            this.#audioEle.pause();
            userMediaStream?.getTracks().forEach((track) => track.stop());
            window.removeEventListener(events.VOICE_SINGAL, handleVoiceMsg);
            peerConnection.close();
          };
        }
      },
      () => [configure.user?.playing?.id, this.state.joined],
    );
  };

  render = () => {
    return html`
      <dy-use
        class="icon"
        @click=${this.#toggleVoice}
        .element=${this.state.joined ? icons.mic : icons.micOff}
      ></dy-use>
    `;
  };
}
