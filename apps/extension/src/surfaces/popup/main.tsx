import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import { TooltipProvider } from '@/ui/volt/tooltip';
import '../styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('popup root element is missing');
// One provider per surface: tooltips then share a delay group, so moving between
// two icon buttons shows the second immediately instead of waiting again.
createRoot(host).render(
  <TooltipProvider delay={250} closeDelay={100}>
    <Popup />
  </TooltipProvider>,
);
