import { createBrowserRouter } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { EditorPage } from '../pages/EditorPage';

// 路由集中在此注册。app 为全屏页面，无共享导航布局。
export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/editor/:id', element: <EditorPage /> },
]);
