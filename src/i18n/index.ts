/**
 * UI 문구 진입점. 현재는 한국어만 제공한다. 다른 언어를 추가하려면 `Messages` 타입을 만족하는
 * 사전을 만들고 여기에서 선택하도록 확장한다(예: navigator.language 또는 사용자 설정).
 */
import { ko, type Messages } from './ko';

export type { Messages };

export const t: Messages = ko;
