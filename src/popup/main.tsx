import { render } from 'preact';
import { App } from './App.js';

const root = document.getElementById('app');
if (root === null) throw new Error('popup root element #app not found');
render(<App />, root);
