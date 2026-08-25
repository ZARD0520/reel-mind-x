import { createBrowserRouter } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { EditorPage } from '../pages/EditorPage';
import { CanvasPage } from '../pages/CanvasPage';

// 路由集中在此注册。app 为全屏页面，无共享导航布局。
export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/project', element: <HomePage /> },
  { path: '/canvas/:id', element: <CanvasPage /> },
  { path: '/editor/:id', element: <EditorPage /> },
]);
