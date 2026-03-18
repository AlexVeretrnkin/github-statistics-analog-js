import { Component } from '@angular/core';
import {Main} from "../components/main/main";

@Component({
  standalone: true,
  template: `<app-main />`,
  imports: [
    Main
  ]
})
export default class HomePageComponent {}
