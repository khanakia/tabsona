import { createRoot } from 'react-dom/client';
import { Gate } from './Gate';
import { TooltipProvider } from '@/ui/volt/tooltip';
import '../styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('gate root element is missing');
createRoot(host).render(
  <TooltipProvider delay={250} closeDelay={100}>
    <Gate />
  </TooltipProvider>,
);
