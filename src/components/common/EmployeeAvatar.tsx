import { isImageAvatarPath } from '@/core/agent/employeeLoader';
import { useAvatarDataUrl } from '@/hooks/useAvatarDataUrl';
import { cn } from '@/lib/utils';

/**
 * Renders a digital-employee avatar: an image (loaded as a data URL) for
 * image-path avatars, otherwise the emoji/initial string as text. Falls back to
 * the raw avatar string while the image loads or if reading fails.
 */
export default function EmployeeAvatar({
  avatar,
  name,
  className,
  fallback,
}: {
  avatar: string | undefined;
  name?: string;
  className?: string;
  /** Shown when the avatar is an image path but the file can't be read. */
  fallback?: React.ReactNode;
}) {
  const src = useAvatarDataUrl(avatar);

  if (src) {
    return <img src={src} alt={name ?? ''} className={cn('w-full h-full object-cover', className)} />;
  }
  // Image path that hasn't resolved (loading or failed) → show fallback, not the raw path.
  if (isImageAvatarPath(avatar)) {
    return <>{fallback ?? (name ? name.slice(0, 1) : '🤖')}</>;
  }
  // Emoji / text avatar.
  return <>{avatar}</>;
}
