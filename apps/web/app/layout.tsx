import type {Metadata,Viewport} from "next"; import type {ReactNode} from "react"; import "./globals.css";
export const metadata:Metadata={title:"Sudoku",applicationName:"Sudoku",description:"Sudoku puzzle",appleWebApp:{capable:true,title:"Sudoku",statusBarStyle:"default"}};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#f7f5ef"};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
