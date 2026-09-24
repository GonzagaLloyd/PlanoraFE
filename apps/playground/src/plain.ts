import './shop.css';
import { SHOP_HTML } from './shop-markup';
import { wireTools } from './shop-tools';

document.body.insertAdjacentHTML('afterbegin', SHOP_HTML);
wireTools();
