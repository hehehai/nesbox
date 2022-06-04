import { GemElement, html, adoptedStyle, customElement, createCSSSheet, css, property } from '@mantou/gem';

import { Room, store } from 'src/store';
import { theme } from 'src/theme';

import 'duoyun-ui/elements/avatar';

const style = createCSSSheet(css`
  :host {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 1em;
    border: 1px solid ${theme.borderColor};
  }
  :host(:hover) {
    background-color: ${theme.lightBackgroundColor};
  }
  .cover {
    width: 10em;
    aspect-ratio: 503/348;
    object-fit: cover;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 1em;
  }
`);

/**
 * @customElement m-room-item
 */
@customElement('m-room-item')
@adoptedStyle(style)
export class MRoomItemElement extends GemElement {
  @property room: Room;

  render = () => {
    const game = store.games[this.room.gameId || 0];

    return html`
        <img class="cover" src=${game?.preview || ''}></img>
        <div class="info">
          <div>${game?.name}</div>
          <dy-avatar-group
            class="users"
            max=9
            .data=${this.room.users.map((e) => ({
              src: `https://joeschmoe.io/api/v1/${e.username}`,
              tooltip: e.username,
            }))}>
          </dy-avatar-group>
        </div>
      `;
  };
}
