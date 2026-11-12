/** The guide's avatar: Armstrong, the astronaut riding a rocket, in a small round badge (shown in the Ask panel and
 *  the welcome bubble). The image is bundled with the app, so it works offline. */
import armstrong from "../../assets/armstrong.png";

export function GuideAvatar({ size = 28 }: { size?: number }) {
  return <img className="pn-avatar" src={armstrong} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
