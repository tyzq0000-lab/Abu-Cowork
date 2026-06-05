import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DefaultUserAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-full h-full flex items-center justify-center bg-[var(--abu-clay-bg)]',
        className
      )}
    >
      <User className="w-1/2 h-1/2 text-[var(--abu-clay)]" strokeWidth={1.75} />
    </div>
  );
}
