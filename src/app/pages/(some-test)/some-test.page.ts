import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {toSignal} from "@angular/core/rxjs-interop";
import {injectLoad} from "@analogjs/router";
import { load } from './some-test.server'
import {JsonPipe} from "@angular/common";

@Component({
  selector: 'app-some-test',
  imports: [
    JsonPipe
  ],
  templateUrl: './some-test.page.html',
  styleUrl: './some-test.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export default class SomeTestPage {
  readonly load = input.required();
}
